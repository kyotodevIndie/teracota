// Host Tauri do harness de paridade. Args: --windows=N --hidden --port=47600
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const SPRITE_X: f64 = 30.0;
const SPRITE_Y: f64 = 170.0;
const SPRITE_S: f64 = 260.0;
const RECT: (f64, f64, f64, f64) = (4.0, 4.0, 40.0, 40.0);

#[derive(Default)]
struct Win {
    ign: bool,
    frame: usize,
}
#[derive(Default)]
struct St {
    masks: Mutex<Vec<Vec<u8>>>,
    wins: Mutex<HashMap<String, Win>>,
    first_paint: Mutex<Option<(f64, f64)>>,
    tray: Mutex<Option<tauri::tray::TrayIcon>>,
}

#[tauri::command]
fn frame(window: WebviewWindow, state: tauri::State<St>, i: usize) {
    state.wins.lock().unwrap().entry(window.label().to_string()).or_default().frame = i;
}
#[tauri::command]
fn set_masks(state: tauri::State<St>, masks: Vec<Vec<u8>>) {
    *state.masks.lock().unwrap() = masks;
}
#[tauri::command]
fn first_paint(window: WebviewWindow, state: tauri::State<St>, epoch: f64, perf: f64) {
    if window.label() == "main" {
        let mut g = state.first_paint.lock().unwrap();
        if g.is_none() {
            *g = Some((epoch, perf));
        }
    }
}

fn hit(masks: &[Vec<u8>], frame: usize, x: f64, y: f64) -> bool {
    if x >= RECT.0 && x < RECT.0 + RECT.2 && y >= RECT.1 && y < RECT.1 + RECT.3 {
        return true;
    }
    let sx = ((x - SPRITE_X) / SPRITE_S * 64.0).floor();
    let sy = ((y - SPRITE_Y) / SPRITE_S * 64.0).floor();
    if sx < 0.0 || sy < 0.0 || sx >= 64.0 || sy >= 64.0 {
        return false;
    }
    masks.get(frame).map(|m| m[(sy as usize) * 64 + sx as usize] > 40).unwrap_or(false)
}

fn info(h: &AppHandle) -> Value {
    let st = h.state::<St>();
    let fp = *st.first_paint.lock().unwrap();
    let wins = st.wins.lock().unwrap();
    let mut ws = vec![];
    for (label, w) in h.webview_windows() {
        let (p, s) = (w.outer_position().unwrap(), w.outer_size().unwrap());
        let sf = w.scale_factor().unwrap();
        let c = wins.get(&label);
        ws.push(json!({"label": label, "x": p.x, "y": p.y, "w": s.width, "h": s.height, "scale": sf,
            "ignore": c.map(|c| c.ign).unwrap_or(false), "frame": c.map(|c| c.frame).unwrap_or(0),
            "visible": w.is_visible().unwrap_or(false)}));
    }
    let mons: Vec<Value> = h
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| json!({"x": m.position().x, "y": m.position().y, "w": m.size().width, "h": m.size().height, "scale": m.scale_factor()}))
        .collect();
    json!({"host": "tauri", "pid": std::process::id(), "tauri": tauri::VERSION,
        "firstPaintEpochMs": fp.map(|f| f.0), "firstPaintPerfMs": fp.map(|f| f.1),
        "masksReady": st.masks.lock().unwrap().len() == 4, "windows": ws, "displays": mons})
}

fn make_tray(h: &AppHandle) -> Value {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let (tx, rx) = std::sync::mpsc::channel();
    let h2 = h.clone();
    let _ = h.run_on_main_thread(move || {
        let r: Result<Value, String> = (|| {
            let a = MenuItem::with_id(&h2, "a", "Item A", true, None::<&str>).map_err(|e| e.to_string())?;
            let q = MenuItem::with_id(&h2, "quit", "Sair", true, None::<&str>).map_err(|e| e.to_string())?;
            let menu = Menu::with_items(&h2, &[&a, &q]).map_err(|e| e.to_string())?;
            let t = TrayIconBuilder::with_id("parity")
                .icon(h2.default_window_icon().ok_or("no icon")?.clone())
                .tooltip("Tera parity")
                .menu(&menu)
                .on_tray_icon_event(|_t, _e| {})
                .on_menu_event(|app, e| {
                    if e.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(&h2)
                .map_err(|e| e.to_string())?;
            let rect = t.rect().map(|r| format!("{:?}", r)).unwrap_or_else(|e| e.to_string());
            *h2.state::<St>().tray.lock().unwrap() = Some(t);
            Ok(json!({"created": true, "rect": rect, "contextMenuSet": true,
                "handlers": "on_tray_icon_event (TrayIconEvent: click esquerdo/direito/duplo) e on_menu_event registrados",
                "note": "verificacao por API; clique real na bandeja nao executado"}))
        })();
        let _ = tx.send(r);
    });
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => json!({"created": false, "error": e}),
        Err(e) => json!({"created": false, "error": e.to_string()}),
    }
}

fn handle(h: &AppHandle, line: &str) -> Value {
    let p: Vec<&str> = line.split_whitespace().collect();
    match p.as_slice() {
        ["info"] => info(h),
        ["show"] => {
            for (_, w) in h.webview_windows() {
                let _ = w.show();
            }
            json!({"ok": true})
        }
        ["freeze", i] => {
            for (_, w) in h.webview_windows() {
                let _ = w.eval(&format!("window.__freeze({})", i));
            }
            std::thread::sleep(Duration::from_millis(100));
            json!({"ok": true})
        }
        ["move", x, y, rest @ ..] => {
            let label = rest.first().copied().unwrap_or("main");
            if let Some(w) = h.get_webview_window(label) {
                let r = w.set_position(PhysicalPosition::new(x.parse::<i32>().unwrap(), y.parse::<i32>().unwrap()));
                std::thread::sleep(Duration::from_millis(300));
                let mut v = info(h);
                v["moveResult"] = json!(format!("{:?}", r));
                v
            } else {
                json!({"error": "no window"})
            }
        }
        ["tray"] => make_tray(h),
        ["quit"] => {
            let h = h.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(20));
                h.exit(0);
            });
            json!({"ok": true})
        }
        _ => json!({"error": "unknown"}),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |k: &str, d: &str| {
        let pre = format!("--{}=", k);
        args.iter().find_map(|a| a.strip_prefix(pre.as_str()).map(|s| s.to_string())).unwrap_or(d.to_string())
    };
    let nwin: i32 = arg("windows", "1").parse().unwrap();
    let port: u16 = arg("port", "47600").parse().unwrap();
    let hidden = args.iter().any(|a| a == "--hidden");

    tauri::Builder::default()
        .manage(St::default())
        .invoke_handler(tauri::generate_handler![frame, set_masks, first_paint])
        .setup(move |app| {
            let h = app.handle().clone();
            for i in 0..nwin {
                let label = if i == 0 { "main".to_string() } else { format!("w{}", i) };
                WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
                    .inner_size(320.0, 440.0)
                    .position(100.0 + 360.0 * i as f64, 100.0)
                    .transparent(true)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .focusable(false)
                    .focused(false)
                    .resizable(false)
                    .shadow(false)
                    .visible(!hidden)
                    .build()?;
            }
            // Polling do cursor a cada 33 ms (mascara alfa > 40)
            {
                let h = h.clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(Duration::from_millis(33));
                    let st = h.state::<St>();
                    let masks = st.masks.lock().unwrap().clone();
                    for (label, w) in h.webview_windows() {
                        if !w.is_visible().unwrap_or(false) {
                            continue;
                        }
                        let (Ok(c), Ok(p), Ok(sf)) = (w.cursor_position(), w.outer_position(), w.scale_factor()) else {
                            continue;
                        };
                        let mut wins = st.wins.lock().unwrap();
                        let e = wins.entry(label).or_default();
                        let ready = masks.len() == 4;
                        let inside = ready && hit(&masks, e.frame, (c.x - p.x as f64) / sf, (c.y - p.y as f64) / sf);
                        let want = ready && !inside;
                        if e.ign != want {
                            e.ign = want;
                            drop(wins);
                            let _ = w.set_ignore_cursor_events(want);
                        }
                    }
                });
            }
            // Canal de controle TCP
            std::thread::spawn(move || {
                let l = TcpListener::bind(("127.0.0.1", port)).unwrap();
                for conn in l.incoming() {
                    let Ok(mut c) = conn else { continue };
                    let mut line = String::new();
                    let _ = BufReader::new(c.try_clone().unwrap()).read_line(&mut line);
                    let out = handle(&h, line.trim());
                    let _ = c.write_all(out.to_string().as_bytes());
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run");
}
