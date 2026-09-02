#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    wavex_lib::ensure_macos_dev_bundle();
    wavex_lib::run()
}
