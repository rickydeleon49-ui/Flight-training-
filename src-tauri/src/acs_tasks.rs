//! Task-level study labels. Never infer a tag from question text.
pub const ACS_TASKS: [(&str, &str); 61] = [
    ("PA.I.A", "Pilot Qualifications"),
    ("PA.I.B", "Airworthiness Requirements"),
    ("PA.I.C", "Weather Information"),
    ("PA.I.D", "Cross-Country Flight Planning"),
    ("PA.I.E", "National Airspace System"),
    ("PA.I.F", "Performance and Limitations"),
    ("PA.I.G", "Operation of Systems"),
    ("PA.I.H", "Human Factors"),
    ("PA.I.I", "Water and Seaplane Characteristics, Seaplane Bases, Maritime Rules, and Aids to Marine Navigation"),
    ("PA.II.A", "Preflight Assessment"),
    ("PA.II.B", "Flight Deck Management"),
    ("PA.II.C", "Engine Starting"),
    ("PA.II.D", "Taxiing (ASEL, AMEL)"),
    ("PA.II.E", "Taxiing and Sailing (ASES, AMES)"),
    ("PA.II.F", "Before Takeoff Check"),
    ("PA.III.A", "Communications, Light Signals, and Runway Lighting Systems"),
    ("PA.III.B", "Traffic Patterns"),
    ("PA.IV.A", "Normal Takeoff and Climb"),
    ("PA.IV.B", "Normal Approach and Landing"),
    ("PA.IV.C", "Soft-Field Takeoff and Climb (ASEL)"),
    ("PA.IV.D", "Soft-Field Approach and Landing (ASEL)"),
    ("PA.IV.E", "Short-Field Takeoff and Maximum Performance Climb (ASEL, AMEL)"),
    ("PA.IV.F", "Short-Field Approach and Landing (ASEL, AMEL)"),
    ("PA.IV.G", "Confined Area Takeoff and Maximum Performance Climb (ASES, AMES)"),
    ("PA.IV.H", "Confined Area Approach and Landing (ASES, AMES)"),
    ("PA.IV.I", "Glassy Water Takeoff and Climb (ASES, AMES)"),
    ("PA.IV.J", "Glassy Water Approach and Landing (ASES, AMES)"),
    ("PA.IV.K", "Rough Water Takeoff and Climb (ASES, AMES)"),
    ("PA.IV.L", "Rough Water Approach and Landing (ASES, AMES)"),
    ("PA.IV.M", "Forward Slip to a Landing (ASEL, ASES)"),
    ("PA.IV.N", "Go-Around/Rejected Landing"),
    ("PA.V.A", "Steep Turns"),
    ("PA.V.B", "Ground Reference Maneuvers"),
    ("PA.VI.A", "Pilotage and Dead Reckoning"),
    ("PA.VI.B", "Navigation Systems and Radar Services"),
    ("PA.VI.C", "Diversion"),
    ("PA.VI.D", "Lost Procedures"),
    ("PA.VII.A", "Maneuvering During Slow Flight"),
    ("PA.VII.B", "Power-Off Stalls"),
    ("PA.VII.C", "Power-On Stalls"),
    ("PA.VII.D", "Spin Awareness"),
    ("PA.VIII.A", "Straight-and-Level Flight"),
    ("PA.VIII.B", "Constant Airspeed Climbs"),
    ("PA.VIII.C", "Constant Airspeed Descents"),
    ("PA.VIII.D", "Turns to Headings"),
    ("PA.VIII.E", "Recovery from Unusual Flight Attitudes"),
    ("PA.VIII.F", "Radio Communications, Navigation Systems/Facilities, and Radar Services"),
    ("PA.IX.A", "Emergency Descent"),
    ("PA.IX.B", "Emergency Approach and Landing (Simulated) (ASEL, ASES)"),
    ("PA.IX.C", "Systems and Equipment Malfunctions"),
    ("PA.IX.D", "Emergency Equipment and Survival Gear"),
    ("PA.IX.E", "Engine Failure During Takeoff Before VMC (Simulated) (AMEL, AMES)"),
    ("PA.IX.F", "Engine Failure After Liftoff (Simulated) (AMEL, AMES)"),
    ("PA.IX.G", "Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)"),
    ("PA.X.A", "Maneuvering with One Engine Inoperative (AMEL, AMES)"),
    ("PA.X.B", "VMC Demonstration (AMEL, AMES)"),
    ("PA.X.C", "One Engine Inoperative (Simulated) During Straight-and-Level Flight and Turns (AMEL, AMES)"),
    ("PA.X.D", "Instrument Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)"),
    ("PA.XI.A", "Night Operations"),
    ("PA.XII.A", "After Landing, Parking, and Securing"),
    ("PA.XII.B", "Seaplane Post-Landing Procedures"),
];

/// Accepts the bare code ("PA.II.A") or the code followed by ITS OWN catalog
/// title ("PA.II.A Preflight Assessment", as models often reply). A title that
/// belongs to another task, or anything else, is rejected: never guess.
pub fn normalize(value: &str) -> Option<String> {
    let value = value.trim();
    let (head, rest) = value.split_once(char::is_whitespace).unwrap_or((value, ""));
    let code = head
        .trim_end_matches([':', '-', '–', ','])
        .to_ascii_uppercase();
    let (known, title) = ACS_TASKS.iter().find(|(known, _)| *known == code)?;
    let rest = rest.trim().trim_start_matches(['-', '–', ':']).trim();
    (rest.is_empty() || rest.eq_ignore_ascii_case(title)).then(|| known.to_string())
}

pub fn prompt() -> String {
    format!("acsTask: the code only (for example \"PA.II.A\") of the one ACS task this question belongs to, chosen ONLY from this list, or null if none fits clearly: {}.",
        ACS_TASKS.iter().map(|(code, title)| format!("{code} {title}")).collect::<Vec<_>>().join("; "))
}

pub fn table_exists(conn: &rusqlite::Connection) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='practice_item_acs_tasks')", [], |r| r.get(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn code_with_its_own_title_is_accepted_other_titles_are_not() {
        assert_eq!(normalize("PA.I.H Human Factors").as_deref(), Some("PA.I.H"));
        assert_eq!(
            normalize("pa.ii.a - preflight assessment").as_deref(),
            Some("PA.II.A")
        );
        assert_eq!(
            normalize("PA.II.A: Preflight Assessment").as_deref(),
            Some("PA.II.A")
        );
        assert_eq!(normalize("PA.I.H Preflight Assessment"), None);
        assert_eq!(normalize("PA.I.H Human Factors and more"), None);
        assert_eq!(normalize("Human Factors"), None);
    }
    #[test]
    fn exact_tasks_only() {
        assert_eq!(ACS_TASKS.len(), 61);
        assert_eq!(normalize(" pa.ii.a ").as_deref(), Some("PA.II.A"));
        for bad in ["PA.II.Z", "PA.II.A.K1", "garbage", "PA. II.A", ""] {
            assert_eq!(normalize(bad), None);
        }
        for (code, _) in ACS_TASKS {
            assert!(prompt().contains(code));
        }
    }
}
