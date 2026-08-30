use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

/// NOTE: sugarmaker descends from the pooler/cpuminer lineage, whose applog()
/// lines have historically looked like:
///
///   [2024-01-01 12:00:00] thread 0: 123456 hashes, 12.34 kH/s
///   [2024-01-01 12:00:00] accepted: 10/10 (100.00%), 45.67 kH/s (yay!!!)
///   [2024-01-01 12:00:00] rejected: 1/11 (9.09%), 44.00 kH/s
///
/// If your fork's actual output differs (different units, different wording),
/// only these three regexes need updating -- nothing else in the app cares
/// about the log format.
static THREAD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)thread\s+(\d+):\s+(\d+)\s+hashes,\s+([\d.]+)\s*([kKmMgG]?)h/s").unwrap()
});

static ACCEPTED_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)accepted:\s*(\d+)/(\d+)\s*\(([\d.]+)%\),\s*([\d.]+)\s*([kKmMgG]?)h/s")
        .unwrap()
});

static REJECTED_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)rejected").unwrap()
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum LogEvent {
    ThreadHashrate { thread: u32, hashes_per_sec: f64 },
    Accepted { accepted: u64, total: u64, rate_hps: f64 },
    Rejected,
    Unrecognized,
}

fn scale(value: f64, unit: &str) -> f64 {
    match unit.to_lowercase().as_str() {
        "k" => value * 1_000.0,
        "m" => value * 1_000_000.0,
        "g" => value * 1_000_000_000.0,
        _ => value,
    }
}

pub fn parse_line(line: &str) -> LogEvent {
    if let Some(caps) = THREAD_RE.captures(line) {
        let thread: u32 = caps[1].parse().unwrap_or(0);
        let value: f64 = caps[3].parse().unwrap_or(0.0);
        let unit = &caps[4];
        return LogEvent::ThreadHashrate {
            thread,
            hashes_per_sec: scale(value, unit),
        };
    }
    if let Some(caps) = ACCEPTED_RE.captures(line) {
        let accepted: u64 = caps[1].parse().unwrap_or(0);
        let total: u64 = caps[2].parse().unwrap_or(0);
        let value: f64 = caps[4].parse().unwrap_or(0.0);
        let unit = &caps[5];
        return LogEvent::Accepted {
            accepted,
            total,
            rate_hps: scale(value, unit),
        };
    }
    if REJECTED_RE.is_match(line) {
        return LogEvent::Rejected;
    }
    LogEvent::Unrecognized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thread_line() {
        let line = "[2024-01-01 12:00:00] thread 0: 123456 hashes, 12.34 kH/s";
        match parse_line(line) {
            LogEvent::ThreadHashrate { thread, hashes_per_sec } => {
                assert_eq!(thread, 0);
                assert!((hashes_per_sec - 12340.0).abs() < 1.0);
            }
            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_accepted_line() {
        let line = "[2024-01-01 12:00:00] accepted: 10/10 (100.00%), 45.67 kH/s (yay!!!)";
        match parse_line(line) {
            LogEvent::Accepted { accepted, total, rate_hps } => {
                assert_eq!(accepted, 10);
                assert_eq!(total, 10);
                assert!((rate_hps - 45670.0).abs() < 1.0);
            }
            other => panic!("wrong variant: {:?}", other),
        }
    }
}
