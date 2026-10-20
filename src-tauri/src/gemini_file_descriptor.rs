//! Native journal references. Only this module reconstructs owned leases.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Descriptor {
    name: String,
    uri: String,
    allowed_host: String,
    mime: String,
    expires_at: i64,
    selected_sha256: String,
    credential_fingerprint: String,
    // HMAC-SHA256 authenticates ownership and every persisted field. A plain
    // digest would let edited metadata authorize deleting someone else's file.
    integrity: String,
}
impl std::fmt::Debug for Descriptor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[native prepared reference]")
    }
}
#[derive(Clone, Copy, Debug)]
pub(crate) enum ReferenceError {
    Invalid,
    KeyChanged,
    Auth,
    Lookup,
}
impl ReferenceError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Invalid => "DESCRIPTOR_INVALID",
            Self::KeyChanged => "KEY_CHANGED",
            Self::Auth => "REFERENCE_AUTH_FAILED",
            Self::Lookup => "REFERENCE_LOOKUP_FAILED",
        }
    }
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Invalid => "The saved PDF reference could not be validated. Your sections are kept; nothing was uploaded.",
            Self::KeyChanged => "The Gemini key or project changed. Explicit Continue is required before preparing this PDF again.",
            Self::Auth => "Google refused access to the saved PDF. Check the key and project; nothing was uploaded.",
            Self::Lookup => "The saved PDF could not be checked. Your sections are kept; nothing was uploaded.",
        }
    }
}
fn hex_digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn allowed_host(base: &str) -> Result<String, ReferenceError> {
    let url = reqwest::Url::parse(base).map_err(|_| ReferenceError::Invalid)?;
    let allowed = base == GOOGLE_BASE;
    #[cfg(test)]
    let allowed = allowed
        || (url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none()
            && url.username().is_empty()
            && url.password().is_none());
    if !allowed {
        return Err(ReferenceError::Invalid);
    }
    Ok(url.host_str().ok_or(ReferenceError::Invalid)?.to_string())
}
impl Descriptor {
    pub(crate) fn name(&self) -> &str {
        &self.name
    }
    fn signature(&self, api_key: &str) -> String {
        // RFC 2104 HMAC with a fixed 32-byte derived key (existing sha2 only).
        // Domain-separated from credential_of: its public fingerprint must
        // never be usable as this authentication key.
        let mut secret = Sha256::new();
        secret.update(b"hfd-native-prepared-auth-key-v1\0");
        secret.update(api_key.as_bytes());
        let key = secret.finalize();
        let mut inner_pad = [0x36u8; 64];
        let mut outer_pad = [0x5cu8; 64];
        for (i, b) in key.iter().enumerate() {
            inner_pad[i] ^= b;
            outer_pad[i] ^= b;
        }
        let mut inner = Sha256::new();
        inner.update(inner_pad);
        inner.update(b"hfd-native-prepared-file-v1\0");
        inner.update(
            serde_json::to_vec(&json!([
                self.name,
                self.uri,
                self.allowed_host,
                self.mime,
                self.expires_at,
                self.selected_sha256,
                self.credential_fingerprint
            ]))
            .expect("descriptor JSON"),
        );
        let mut outer = Sha256::new();
        outer.update(outer_pad);
        outer.update(inner.finalize());
        hex::encode(outer.finalize())
    }
    pub(crate) fn from_lease(
        lease: &Lease<'_>,
        base: &str,
        api_key: &str,
        selected_sha256: &str,
    ) -> Result<Self, ReferenceError> {
        let p = lease.prepared();
        let mut d = Self {
            name: p.name.clone(),
            uri: p.uri.clone(),
            allowed_host: allowed_host(base)?,
            mime: p.mime.clone(),
            expires_at: p.expires_at,
            selected_sha256: selected_sha256.into(),
            credential_fingerprint: credential_of(api_key),
            integrity: String::new(),
        };
        d.integrity = d.signature(api_key);
        d.validate(base, api_key, selected_sha256)?;
        Ok(d)
    }
    fn validate(
        &self,
        base: &str,
        api_key: &str,
        selected_sha256: &str,
    ) -> Result<(), ReferenceError> {
        if self.allowed_host != allowed_host(base)?
            || self.mime != "application/pdf"
            || self.selected_sha256 != selected_sha256
            || !hex_digest(&self.selected_sha256)
            || !hex_digest(&self.credential_fingerprint)
            || !hex_digest(&self.integrity)
            || self.expires_at <= 0
        {
            return Err(ReferenceError::Invalid);
        }
        parse_file(
            &json!({"name":self.name,"uri":self.uri,"mimeType":self.mime,"state":"ACTIVE"}),
            base,
            &self.mime,
        )
        .map_err(|_| ReferenceError::Invalid)?;
        if self.credential_fingerprint != credential_of(api_key) {
            return Err(ReferenceError::KeyChanged);
        }
        let expected = self.signature(api_key);
        if self
            .integrity
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            != 0
        {
            return Err(ReferenceError::Invalid);
        }
        Ok(())
    }
    fn retired(&self, base: &str) -> Retired {
        Retired {
            credential: self.credential_fingerprint.clone(),
            base: base.into(),
            name: self.name.clone(),
        }
    }
    pub(crate) fn same_remote(&self, other: &Self) -> bool {
        self.name == other.name
            && self.uri == other.uri
            && self.credential_fingerprint == other.credential_fingerprint
    }
}
impl PreparedSources {
    /// Restore only authenticated native metadata. Missing/expired is the only
    /// result that permits a replacement. No generic cache fallback is used.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn resume_reference<'a>(
        &'a self,
        d: &Descriptor,
        http: &Client,
        base: &str,
        api_key: &str,
        source: &Source<'_>,
        epoch: u64,
        budget: &Budget,
    ) -> Result<Option<Lease<'a>>, ReferenceError> {
        d.validate(base, api_key, source.content_sha256)?;
        if self.epoch() != epoch {
            return Err(ReferenceError::Lookup);
        }
        if (self.clock)() >= d.expires_at {
            return Ok(None);
        }
        let remote = match lookup(http, base, api_key, &d.name, &d.mime, budget).await {
            Ok(remote) => remote,
            Err(LookupFailure::Missing) => return Ok(None),
            Err(LookupFailure::Auth(_)) => return Err(ReferenceError::Auth),
            Err(LookupFailure::Other(_)) => return Err(ReferenceError::Lookup),
        };
        let expiry = remote.expires_at.unwrap_or(d.expires_at).min(d.expires_at);
        if (self.clock)() >= expiry {
            return Ok(None);
        }
        if remote.state != FileState::Active {
            return Err(ReferenceError::Lookup);
        }
        let mut inner = self.lock();
        if inner.epoch != epoch {
            return Err(ReferenceError::Lookup);
        }
        let id = d.retired(base);
        inner.acquire(&id);
        self.count(|s| s.reuses += 1);
        Ok(Some(Lease {
            cache: self,
            id,
            epoch,
            prepared: Prepared {
                name: d.name.clone(),
                uri: d.uri.clone(),
                mime: d.mime.clone(),
                expires_at: expiry,
                reused: true,
            },
        }))
    }
    /// Keep ownership while paused, across eviction/disconnect. Serialize the
    /// commit with invalidation so a committed reference cannot race deletion.
    pub(crate) fn retain_committed<E>(
        &self,
        lease: &Lease<'_>,
        owner: &str,
        persist: impl FnOnce() -> Result<(), E>,
    ) -> Result<bool, E> {
        let mut inner = self.lock();
        if inner.epoch != lease.epoch {
            return Ok(false);
        }
        persist()?;
        for owners in inner.retained.values_mut() {
            owners.remove(owner);
        }
        inner.retained.retain(|_, owners| !owners.is_empty());
        inner
            .retained
            .entry(lease.id.clone())
            .or_default()
            .insert(owner.into(), lease.prepared.expires_at);
        Ok(true)
    }
    pub(crate) fn release_owner(&self, owner: &str) {
        let mut inner = self.lock();
        for owners in inner.retained.values_mut() {
            owners.remove(owner);
        }
        inner.retained.retain(|_, owners| !owners.is_empty());
    }
    /// Only after deliberate acknowledgement/discard was durably committed.
    pub(crate) async fn discard_reference(
        &self,
        d: &Descriptor,
        owner: &str,
        http: &Client,
        base: &str,
        api_key: &str,
        selected_sha256: &str,
    ) {
        if d.validate(base, api_key, selected_sha256).is_err() {
            return;
        }
        let retired = d.retired(base);
        let mut ready_to_delete = vec![];
        {
            let mut inner = self.lock();
            if let Some(owners) = inner.retained.get_mut(&retired) {
                owners.remove(owner);
            }
            inner
                .ready
                .retain(|_, r| r.prepared.name != d.name || r.prepared.uri != d.uri);
            inner.retire_later(retired, &mut ready_to_delete);
        }
        self.retire(http, api_key, ready_to_delete).await;
    }
    pub(super) fn retained(&self, r: &Retired) -> bool {
        self.lock()
            .retained
            .get(r)
            .is_some_and(|owners| owners.values().any(|expiry| (self.clock)() < *expiry))
    }
}
