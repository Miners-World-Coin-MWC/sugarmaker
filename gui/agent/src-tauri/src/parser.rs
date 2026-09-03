use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

/// Sugarmaker hash-rate output can use:
///
///   249.4 hash/s
///   249.4 H/s
///   12.34 kH/s
///   1.25 MH/s
///   1.25 GH/s
///
/// The current MWC build outputs `hash/s`, so the parser explicitly supports
/// both `hash/s` and the shorter `H/s` form.
static THREAD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)thread\s+(\d+):\s+(\d+)\s+hashes,\s+(\d+(?:\.\d+)?)\s*([kKmMgG]?)\s*(?:hash|h)/s\b",
    )
    .unwrap()
});

/// Accepted share output can look like:
///
///   accepted: 1/1 (100.00%), 434.4 hash/s (yay!!!)
///   accepted: 10/10 (100.00%), 45.67 kH/s (yay!!!)
///   accepted: 10/10 (100.00%)
///
/// The rate portion is optional so accepted shares are still detected even
/// when the miner does not print a hashrate on that line.
static ACCEPTED_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)accepted:\s*(\d+)\s*/\s*(\d+)\s*\(([\d.]+)%\)(?:,\s*(\d+(?:\.\d+)?)\s*([kKmMgG]?)\s*(?:hash|h)/s\b)?",
    )
    .unwrap()
});

/// Any line containing "rejected" is treated as a rejected share event.
static REJECTED_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\brejected\b").unwrap()
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum LogEvent {
    ThreadHashrate {
        thread: u32,
        hashes_per_sec: f64,
    },

    Accepted {
        accepted: u64,
        total: u64,
        rate_hps: f64,
    },

    Rejected,

    Unrecognized,
}

/// Convert a parsed hashrate value into hashes per second.
///
/// Examples:
///
///   249.4 H/s  -> 249.4
///   1.25 kH/s  -> 1250
///   1.25 MH/s  -> 1,250,000
///   1.25 GH/s  -> 1,250,000,000
fn scale(value: f64, unit: &str) -> f64 {
    match unit.to_ascii_lowercase().as_str() {
        "k" => value * 1_000.0,
        "m" => value * 1_000_000.0,
        "g" => value * 1_000_000_000.0,
        _ => value,
    }
}

pub fn parse_line(line: &str) -> LogEvent {
    // Thread hashrate:
    //
    // thread 1: 6969 hashes, 208.1 hash/s
    if let Some(caps) = THREAD_RE.captures(line) {
        let thread: u32 = caps[1].parse().unwrap_or(0);
        let value: f64 = caps[3].parse().unwrap_or(0.0);
        let unit = &caps[4];

        return LogEvent::ThreadHashrate {
            thread,
            hashes_per_sec: scale(value, unit),
        };
    }

    // Accepted share:
    //
    // accepted: 1/1 (100.00%), 434.4 hash/s (yay!!!)
    if let Some(caps) = ACCEPTED_RE.captures(line) {
        let accepted: u64 = caps[1].parse().unwrap_or(0);
        let total: u64 = caps[2].parse().unwrap_or(0);

        let rate_hps = if let Some(rate) = caps.get(4) {
            let value: f64 = rate.as_str().parse().unwrap_or(0.0);
            let unit = caps.get(5).map(|m| m.as_str()).unwrap_or("");

            scale(value, unit)
        } else {
            0.0
        };

        return LogEvent::Accepted {
            accepted,
            total,
            rate_hps,
        };
    }

    // Rejected share.
    if REJECTED_RE.is_match(line) {
        return LogEvent::Rejected;
    }

    LogEvent::Unrecognized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thread_hash_per_second() {
        let line =
            "[2026-09-03 18:20:47] thread 1: 6969 hashes, 208.1 hash/s";

        match parse_line(line) {
            LogEvent::ThreadHashrate {
                thread,
                hashes_per_sec,
            } => {
                assert_eq!(thread, 1);
                assert!((hashes_per_sec - 208.1).abs() < 0.01);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_second_thread_hash_per_second() {
        let line =
            "[2026-09-03 18:21:22] thread 0: 13577 hashes, 200.5 hash/s";

        match parse_line(line) {
            LogEvent::ThreadHashrate {
                thread,
                hashes_per_sec,
            } => {
                assert_eq!(thread, 0);
                assert!((hashes_per_sec - 200.5).abs() < 0.01);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_thread_h_per_second() {
        let line = "thread 0: 1000 hashes, 250.5 H/s";

        match parse_line(line) {
            LogEvent::ThreadHashrate {
                thread,
                hashes_per_sec,
            } => {
                assert_eq!(thread, 0);
                assert!((hashes_per_sec - 250.5).abs() < 0.01);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_thread_kh_per_second() {
        let line = "thread 0: 1000 hashes, 12.34 kH/s";

        match parse_line(line) {
            LogEvent::ThreadHashrate {
                thread,
                hashes_per_sec,
            } => {
                assert_eq!(thread, 0);
                assert!((hashes_per_sec - 12340.0).abs() < 0.01);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_thread_mh_per_second() {
        let line = "thread 0: 1000 hashes, 1.25 MH/s";

        match parse_line(line) {
            LogEvent::ThreadHashrate {
                thread,
                hashes_per_sec,
            } => {
                assert_eq!(thread, 0);
                assert!((hashes_per_sec - 1_250_000.0).abs() < 0.01);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_thread_gh_per_second() {
        let line = "thread 0: 1000 hashes, 1.25 GH/s";

        match parse_line(line) {
            LogEvent::ThreadHashrate {
                thread,
                hashes_per_sec,
            } => {
                assert_eq!(thread, 0);
                assert!((hashes_per_sec - 1_250_000_000.0).abs() < 0.01);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_accepted_hash_per_second() {
        let line =
            "[2026-09-03 18:20:47] accepted: 1/1 (100.00%), 434.4 hash/s (yay!!!)";

        match parse_line(line) {
            LogEvent::Accepted {
                accepted,
                total,
                rate_hps,
            } => {
                assert_eq!(accepted, 1);
                assert_eq!(total, 1);
                assert!((rate_hps - 434.4).abs() < 0.01);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_accepted_kh_per_second() {
        let line =
            "[2024-01-01 12:00:00] accepted: 10/10 (100.00%), 45.67 kH/s (yay!!!)";

        match parse_line(line) {
            LogEvent::Accepted {
                accepted,
                total,
                rate_hps,
            } => {
                assert_eq!(accepted, 10);
                assert_eq!(total, 10);
                assert!((rate_hps - 45670.0).abs() < 0.01);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_accepted_without_rate() {
        let line =
            "[2026-09-03 18:20:47] accepted: 1/1 (100.00%)";

        match parse_line(line) {
            LogEvent::Accepted {
                accepted,
                total,
                rate_hps,
            } => {
                assert_eq!(accepted, 1);
                assert_eq!(total, 1);
                assert_eq!(rate_hps, 0.0);
            }

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn parses_rejected_line() {
        let line =
            "[2024-01-01 12:00:00] rejected: 1/11 (9.09%), 44.00 kH/s";

        match parse_line(line) {
            LogEvent::Rejected => {}

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn ignores_unrecognized_line() {
        let line =
            "[2026-09-03 18:19:26] Starting Stratum on stratum+tcp://bmine.net:3033";

        match parse_line(line) {
            LogEvent::Unrecognized => {}

            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn ignores_algorithm_startup_line() {
        let line =
            "[2026-09-03 18:19:26] 2 miner threads started, using 'YespowerMwc' algorithm.";

        match parse_line(line) {
            LogEvent::Unrecognized => {}

            other => panic!("wrong variant: {:?}", other),
        }
    }
}
