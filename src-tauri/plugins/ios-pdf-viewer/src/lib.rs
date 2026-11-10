//! Internal iOS bridge. No frontend plugin commands or arbitrary-path IPC.
#![cfg(target_os = "ios")]
use serde::Serialize;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_hfd_pdf);

pub struct PdfViewer<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPdf<'a> {
    pub path: &'a str,
    pub title: &'a str,
    pub physical_page: u32,
}

impl<R: Runtime> PdfViewer<R> {
    /// Completes on Done/dismissal, keeping the Rust snapshot alive throughout.
    pub async fn open(&self, options: OpenPdf<'_>) -> Result<(), String> {
        self.0
            .run_mobile_plugin_async("openPdf", options)
            .await
            .map_err(|e| e.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("hfd-pdf")
        .setup(|app, api| {
            app.manage(PdfViewer(api.register_ios_plugin(init_plugin_hfd_pdf)?));
            Ok(())
        })
        .build()
}
