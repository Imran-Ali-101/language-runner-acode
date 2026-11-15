const PLUGIN_ID = "imran.alllang.runner";
const DEBUG = false; // set to true to see debug toasts

// Marker files shared between the terminal (Alpine) and the plugin (Android side)
const FLAG_PATH = "/sdcard/.pyrun_running"; // exists while a program is running
const FLAG_URL = "file:///storage/emulated/0/.pyrun_running";
const DONE_PATH = "/sdcard/.pyrun_done"; // created when a program has finished
const DONE_URL = "file:///storage/emulated/0/.pyrun_done";

// If no marker appears within this time, process tracking is considered unavailable
const NO_MARKER_TIMEOUT = 8000;

// ---- VNC mode ----
// When the file is a VNC/GUI program, the runner starts the VNC server (and noVNC),
// sets DISPLAY, runs the program, then opens the noVNC page in Acode's browser.
const VNC_DISPLAY = ":1";   // X display used by your VNC server
const VNC_PORT = 5901;      // VNC server port (5900 + display number)
const NOVNC_PORT = 6080;    // port where noVNC (websockify) listens
const NOVNC_WEB = "/usr/share/novnc"; // noVNC web folder inside Alpine
const NOVNC_URL = "http://localhost:" + NOVNC_PORT + "/vnc.html?autoconnect=true&resize=remote";
// The terminal creates this file when the VNC servers are ready; the plugin then opens the viewer
const VNC_READY_PATH = "/sdcard/.pyrun_vnc_ready";
const VNC_READY_URL = "file:///storage/emulated/0/.pyrun_vnc_ready";
const VNC_WAIT_MAX = 15000;  // give up waiting for the servers after this (ms)
const VNC_SIZE = "800x600";  // start size only: the screen then follows the browser size / rotation (resize=remote)
const VNC_TITLE_FONT = 14;   // title bar font size in pt: bigger = bigger minimize/maximize/close buttons
const VNC_MAXIMIZE = true;   // maximize every window to fill the screen (needs openbox)
// Start each server only if it is not already running (needs: apk add tigervnc novnc websockify)
const VNC_PREP =
  // X server + VNC in one process (Xvnc), no password, local connections only
  `(pgrep -x Xvnc >/dev/null 2>&1 || (Xvnc ${VNC_DISPLAY} -geometry ${VNC_SIZE} -depth 24 -SecurityTypes None -interface 127.0.0.1 >/dev/null 2>&1 &)); ` +
  // wait until the X socket exists (max ~5 s)
  `for i in 1 2 3 4 5 6 7 8 9 10; do [ -e /tmp/.X11-unix/X${VNC_DISPLAY.slice(1)} ] && break; sleep 0.5; done; ` +
  // optional window manager (openbox), only if installed. Uses its own config file
  // (created once from the system default) with big title bars and maximized windows.
  `if command -v openbox >/dev/null 2>&1; then ` +
  `c="$HOME/.config/openbox/pyrun-rc.xml"; ` +
  `if [ ! -f "$c" ] && [ -f /etc/xdg/openbox/rc.xml ]; then ` +
  `mkdir -p "$HOME/.config/openbox"; ` +
  `sed ${VNC_MAXIMIZE ? `-e 's#<applications>#<applications><application class="*"><maximized>yes</maximized></application>#' ` : ""}` +
  `-e 's#<size>8</size>#<size>${VNC_TITLE_FONT}</size>#g' /etc/xdg/openbox/rc.xml > "$c"; pkill -x openbox; fi; ` +
  `o=""; [ -f "$c" ] && o="--config-file $c"; ` +
  `pgrep -x openbox >/dev/null 2>&1 || (DISPLAY=${VNC_DISPLAY} openbox $o >/dev/null 2>&1 &); fi; ` +
  // noVNC web bridge
  `(pgrep -f websockify >/dev/null 2>&1 || websockify -D --web ${NOVNC_WEB} ${NOVNC_PORT} localhost:${VNC_PORT} >/dev/null 2>&1); ` +
  // wait until noVNC accepts connections (max ~5 s), then tell the plugin it can open the viewer
  `for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25; do ` +
  `python3 -c "import socket;socket.create_connection(('127.0.0.1',${NOVNC_PORT}),0.2)" >/dev/null 2>&1 && break; sleep 0.2; done; ` +
  `touch ${VNC_READY_PATH}; ` +
  `export DISPLAY=${VNC_DISPLAY}; `;
// A file uses VNC if a comment line has the word "vnc", or it imports a GUI library
const VNC_MARKER = /^\s*(#|\/\/|--|\/\*)[^\n]*\bvnc\b/im;
const GUI_IMPORT = /^\s*(import|from)\s+(tkinter|Tkinter|turtle|pygame|PyQt\d|PySide\d|kivy|wx)\b/m;

// How often the button checks whether the editor is the visible page (ms)
const VISIBILITY_POLL = 400;

// ---- Button position ----
const BTN_SIZE = 40;      // button size (px)
const RIGHT_OFFSET = 128; // distance from the right edge (larger = further left)
const TOP_ADJUST = 0;     // fine-tune vertical position (positive = down)

// Texts used to recognize our row on the plugin settings page
const ITEM_TITLE = "Languages & commands";
const ITEM_INFO = "Add, edit or delete languages, extensions and commands";

// Bump this when DEFAULT_LANGS changes.
// Missing defaults are then merged into the user's saved list once,
// and entries listed in REMOVED_DEFAULTS are dropped (only if the user did not edit them).
const DEFAULTS_VERSION = 6;

// Verilog / SystemVerilog: runs ~/wave.py (compile + simulate + timing diagram) automatically.
// - Active file "x_tb.v" -> design "x.v" is added; active file "x.v" -> testbench "x_tb.v" is added.
//   If the partner file does not exist, only the active file is used.
// - Everything runs inside a temporary folder that is deleted afterwards, so sim_out and
//   wave.vcd never appear in your project.
// - [WAVE] is the wave.py that is bundled inside this plugin (written to shared storage on demand).
// - If it cannot be written, falls back to plain iverilog + vvp.
const VERILOG_CMD =
  'f=[FILENAME]; d=[DIR]; n=[NAME]; b=${n%_tb}; e=${f##*.}; w=/tmp/pyrun_v; rm -rf "$w"; mkdir -p "$w"; ' +
  '( if [ -f "$d/$b.$e" ] && [ -f "$d/${b}_tb.$e" ]; then set -- "$d/$b.$e" "$d/${b}_tb.$e"; else set -- "$f"; fi; ' +
  'cd "$w" && if [ -f [WAVE] ]; then python3 [WAVE] "$@" sim_out; ' +
  'else iverilog -g2012 -o sim_out "$@" && vvp sim_out; fi ); ' +
  'rc=$?; cd /; rm -rf "$w"; (exit $rc)';

// ---- Default languages and commands ----
// Placeholders: [FILENAME] = file path, [NAME] = file name without extension, [DIR] = folder
// JavaScript is intentionally missing: Acode already has a built-in runner for it.
const DEFAULT_LANGS = [
  { name: "Python", exts: "py", command: "python3 -u [FILENAME]" },
  { name: "C", exts: "c", command: "gcc [FILENAME] -o /tmp/pyrun_out -lm && /tmp/pyrun_out" },
  { name: "C++", exts: "cpp,cc,cxx", command: "g++ [FILENAME] -o /tmp/pyrun_out && /tmp/pyrun_out" },
  { name: "Java", exts: "java", command: "java [FILENAME]" },
  { name: "TypeScript", exts: "ts", command: "npx -y tsx [FILENAME]" },
  {
    name: "React (Vite dev server)",
    exts: "jsx,tsx",
    // walks up from the file's folder to the nearest package.json, then starts the dev server
    command:
      'd=[DIR]; while [ ! -f "$d/package.json" ] && [ "$d" != "/" ]; do d=$(dirname "$d"); done; ' +
      'if [ -f "$d/package.json" ]; then cd "$d" && npm run dev -- --host; else echo "package.json not found"; false; fi',
  },
  { name: "PHP", exts: "php", command: "php [FILENAME]" },
  { name: "Ruby", exts: "rb", command: "ruby [FILENAME]" },
  { name: "Go", exts: "go", command: "go run [FILENAME]" },
  { name: "Rust", exts: "rs", command: "rustc [FILENAME] -o /tmp/pyrun_out && /tmp/pyrun_out" },
  {
    name: "Kotlin",
    exts: "kt",
    command: "kotlinc [FILENAME] -include-runtime -d /tmp/pyrun.jar && java -jar /tmp/pyrun.jar",
  },
  { name: "Lua", exts: "lua", command: "lua5.4 [FILENAME]" },
  { name: "Perl", exts: "pl", command: "perl [FILENAME]" },
  { name: "R", exts: "r", command: "Rscript [FILENAME]" },
  {
    name: "Shell",
    exts: "sh,bash",
    // use bash when it is installed, otherwise fall back to the default sh
    command: "if command -v bash >/dev/null 2>&1; then bash [FILENAME]; else sh [FILENAME]; fi",
  },
  { name: "Fortran", exts: "f90,f95,f", command: "gfortran [FILENAME] -o /tmp/pyrun_out && /tmp/pyrun_out" },
  { name: "Haskell", exts: "hs", command: "runghc [FILENAME]" },
  { name: "Elixir", exts: "exs", command: "elixir [FILENAME]" },
  { name: "OCaml", exts: "ml", command: "ocaml [FILENAME]" },
  { name: "Verilog", exts: "v", command: VERILOG_CMD },
  {
    name: "SystemVerilog",
    exts: "sv",
    command: VERILOG_CMD,
  },
  { name: "SQL (SQLite)", exts: "sql", command: "sqlite3 :memory: < [FILENAME]" },
  { name: "Julia", exts: "jl", command: "julia [FILENAME]" },
  { name: "Dart", exts: "dart", command: "dart run [FILENAME]" },
  { name: "Zig", exts: "zig", command: "zig run [FILENAME]" },
];

// Defaults that were removed from the plugin. They are deleted from the saved list
// only when name and command still match, so user-edited entries are never touched.
const REMOVED_DEFAULTS = [
  { name: "Verilog", command: "f=[FILENAME]; d=[DIR]; n=[NAME]; b=${n%_tb}; e=${f##*.}; w=/tmp/pyrun_v; rm -rf \"$w\"; mkdir -p \"$w\"; ( if [ -f \"$d/$b.$e\" ] && [ -f \"$d/${b}_tb.$e\" ]; then set -- \"$d/$b.$e\" \"$d/${b}_tb.$e\"; else set -- \"$f\"; fi; cd \"$w\" && if [ -f ~/wave.py ]; then python3 ~/wave.py \"$@\" sim_out; else iverilog -g2012 -o sim_out \"$@\" && vvp sim_out; fi ); rc=$?; cd /; rm -rf \"$w\"; (exit $rc)" },
  { name: "SystemVerilog", command: "f=[FILENAME]; d=[DIR]; n=[NAME]; b=${n%_tb}; e=${f##*.}; w=/tmp/pyrun_v; rm -rf \"$w\"; mkdir -p \"$w\"; ( if [ -f \"$d/$b.$e\" ] && [ -f \"$d/${b}_tb.$e\" ]; then set -- \"$d/$b.$e\" \"$d/${b}_tb.$e\"; else set -- \"$f\"; fi; cd \"$w\" && if [ -f ~/wave.py ]; then python3 ~/wave.py \"$@\" sim_out; else iverilog -g2012 -o sim_out \"$@\" && vvp sim_out; fi ); rc=$?; cd /; rm -rf \"$w\"; (exit $rc)" },
  { name: "JavaScript", command: "node [FILENAME]" },
  { name: "Verilog", command: "iverilog -o /tmp/pyrun_vvp [FILENAME] && vvp /tmp/pyrun_vvp" },
  { name: "SystemVerilog", command: "iverilog -g2012 -o /tmp/pyrun_vvp [FILENAME] && vvp /tmp/pyrun_vvp" },
];

// ---- Bundled wave.py (Verilog timing diagram) ----
// Written to shared storage when a command uses the [WAVE] placeholder.
const WAVE_PATH = "/sdcard/.pyrun_wave.py";
const WAVE_DIR_URL = "file:///storage/emulated/0/";
const WAVE_NAME = ".pyrun_wave.py";
const CMD_NAME = ".pyrun_cmd.sh";      // the command script of the current run
const CMD_PATH = "/sdcard/.pyrun_cmd.sh";
const WAVE_PY = String.raw`import sys, os, subprocess
from vcd.reader import tokenize

# ── Args: python3 wave.py file1.v file2.v sim_name ──
args = sys.argv[1:]

if any(a in ("-h", "--help", "help") for a in args):
    Y = "\033[01;33m"; G = "\033[01;32m"; C = "\033[01;36m"; N = "\033[0m"
    print(f"""
{Y}wave.py{N} - Verilog simulation + terminal timing diagram

{Y}USAGE{N}
  python3 ~/wave.py {G}<files.v/.sv ...> [sim_name]{N}   compile, simulate, show waves
  python3 ~/wave.py                          show existing wave.vcd only
  python3 ~/wave.py --help                   this help

{Y}EXAMPLES{N}
  {C}python3 ~/wave.py and_gate.v and_gate_tb.v and_sim{N}
  {C}python3 ~/wave.py bcd_adder.v bcd_adder_tb.v{N}

{Y}NOTES{N}
  - Run it inside the folder that has your .v files.
  - sim_name is optional (any word without .v), default: sim_out
  - Testbench must contain:
      $dumpfile("wave.vcd");  $dumpvars(0, tb);
      and  \x60timescale 1ns/1ps  at the top
  - Needs: iverilog, vvp, and  pip install pyvcd

{Y}READING THE OUTPUT{N}
  1-bit signal  high/low wave  (clk, cin, cout)
  multi-bit     bus with value  ╪[5]  (value changes at ╪)
  ░░░           unknown value (x), e.g. before first reset
  Long timelines split into several blocks to fit the screen.
""")
    sys.exit(0)
HDL_EXT = (".v", ".sv")
v_files = [a for a in args if a.endswith(HDL_EXT)]
sim_name = next((a for a in args if not a.endswith(HDL_EXT)), "sim_out")

if v_files:
    print("\033[01;33m[1/2] Compiling...\033[0m")
    sv_flag = ["-g2012"] if any(f.endswith(".sv") for f in v_files) else []
    # Testbench has no $dumpfile: add a tiny module that dumps every signal to wave.vcd
    extra = []
    if not any("$dumpfile" in open(f, errors="ignore").read() for f in v_files):
        with open("_autodump.v", "w") as fh:
            fh.write('module _autodump; initial begin $dumpfile("wave.vcd"); $dumpvars(0); end endmodule\n')
        extra = ["_autodump.v"]
    r1 = subprocess.run(["iverilog"] + sv_flag + ["-o", sim_name] + v_files + extra, capture_output=True, text=True)
    if extra: os.remove("_autodump.v")
    if r1.returncode != 0:
        print(f"\033[01;31mCompile Error:\033[0m\n{r1.stderr}"); sys.exit(1)
    if os.path.exists("wave.vcd"): os.remove("wave.vcd")   # avoid showing a stale waveform
    print("\033[01;33m[2/2] Simulating...\033[0m")
    r2 = subprocess.run(["vvp", sim_name], capture_output=True, text=True)
    if r2.returncode != 0:
        print(f"\033[01;31mSim Error:\033[0m\n{r2.stderr}"); sys.exit(1)
    print(r2.stdout)
    if not os.path.exists("wave.vcd"):   # testbench used another dump file name: use that one
        import glob
        other = glob.glob("*.vcd")
        if other: os.rename(other[0], "wave.vcd")

# ── Terminal width (last column left empty to avoid auto-wrap) ──
try:    TW = os.get_terminal_size().columns
except: TW = int(os.environ.get("COLUMNS", 60))
TW = min(max(TW, 30), 120)
IW = TW - 3                      # box total width = IW + 2 = TW - 1

C='\033[01;36m'; Y='\033[01;33m'; G='\033[01;32m'
R='\033[01;31m'; B='\033[01;34m'; M='\033[01;35m'
W='\033[01;37m'; N='\033[0m'

def rep(ch, n): return ch * max(n, 0)
def draw_top(): print(f"{C}╭{rep('─',IW)}╮{N}")
def draw_mid(): print(f"{C}├{rep('─',IW)}┤{N}")
def draw_bot(): print(f"{C}╰{rep('─',IW)}╯{N}")
def row(colored, plain):
    pad = IW - 1 - len(plain)
    print(f"{C}│{N} {colored}{rep(' ',pad)}{C}│{N}")

# ── VCD Parse ──
times = []; signals = {}; id_to_name = {}; sizes = {}; cur_t = 0
vcd_file = "wave.vcd"
if not os.path.exists(vcd_file):
    print(f"{Y}Note:{N} no waveform to show ({vcd_file} was not created).")
    print(f"      Add $dumpfile(\"wave.vcd\"); $dumpvars(0, tb); to the testbench for a timing diagram.")
    sys.exit(0)

try:
    with open(vcd_file, "rb") as f:
        for tok in tokenize(f):
            k = tok.kind.name
            if k == "VAR":
                id_to_name[tok.data.id_code] = tok.data.reference
                signals[tok.data.reference] = {}
                sizes[tok.data.reference] = tok.data.size
            elif k == "CHANGE_TIME":
                cur_t = tok.data
                if cur_t not in times: times.append(cur_t)
            elif k in ("CHANGE_SCALAR", "CHANGE_VECTOR"):
                val = tok.data.value if hasattr(tok.data, "value") else str(tok.data)
                idc = tok.data.id_code if hasattr(tok.data, "id_code") else ""
                if idc in id_to_name:
                    signals[id_to_name[idc]][cur_t] = str(val)
except Exception as e:
    print(f"{R}Parse error: {e}{N}"); sys.exit(1)

times = sorted(times)
if not times:
    print(f"{R}No data in VCD{N}"); sys.exit(1)

def tlabel(t): return f"{t//1000}ns"
SIG_W = min(10, max(6, max(len(n) for n in signals) if signals else 6))
SWMIN = max(len(tlabel(t)) for t in times) + 1       # minimum width of one time slot
PFX = SIG_W + 3                                      # "name │ "
PER_ROW = max(1, (IW - 1 - PFX) // SWMIN)            # max slots per block
NBLK = -(-len(times) // PER_ROW)                     # number of blocks
PER_ROW = -(-len(times) // NBLK)                     # balance slots across blocks
SW = max(SWMIN, (IW - 2 - PFX) // PER_ROW)           # stretch slots to fill the box

def to_dec(raw):
    s = str(raw).lstrip("b")
    return int(s) if s.isdigit() else s

def get_last(name, t):
    h = signals.get(name, {}); last = "0"
    for ts in sorted(h):
        if ts <= t: last = h[ts]
    return last

def values(name):
    """Value (as string) of a signal at every time slot."""
    h = signals[name]; out = []; last = "0"
    for t in times:
        if t in h: last = h[t]
        out.append(last)
    return out

def is_bit(name):
    return sizes.get(name, 1) == 1

def build_wave(vals, a, b):
    """Wave strings for slots a..b-1. Looks at slot a-1 so edges show across blocks."""
    top = ""; bot = ""
    for i in range(a, b):
        v = vals[i]; prev = vals[i-1] if i > 0 else v
        if v in ("x", "z"):
            top += rep("░", SW); bot += rep("░", SW)
        elif prev == v or prev in ("x", "z") or i == 0:
            if v == "1": top += rep("─", SW); bot += rep(" ", SW)
            else:        top += rep(" ", SW); bot += rep("─", SW)
        elif v == "1":   # rising
            top += "┌" + rep("─", SW-1); bot += "┘" + rep(" ", SW-1)
        else:            # falling
            top += "┐" + rep(" ", SW-1); bot += "└" + rep("─", SW-1)
    return top, bot

def sig_order(s):
    sl = s.lower()
    for p in ["cin","clk","a","b","c","d","in","input"]:
        if p in sl: return 0
    for p in ["cout","carry","out","output","result"]:
        if p in sl: return 1
    for p in ["sum","binary","reg"]:
        if p in sl: return 2
    return 3

show = sorted(signals.keys(), key=sig_order)

# ── CARD 1: Timing Diagram (split into blocks that fit the screen) ──
print(); draw_top()
title = "DIGITAL TIMING DIAGRAM"
row(f"{Y}{title.center(IW-1)}{N}", title.center(IW-1))

all_vals = {n: values(n) for n in show}
for a in range(0, len(times), PER_ROW):
    b = min(a + PER_ROW, len(times))
    draw_mid()
    tl = f"{'Signal':<{SIG_W}} │ " + "".join(f"{tlabel(t):<{SW}}" for t in times[a:b])
    row(f"{Y}{tl}{N}", tl)
    for name in show:
        vals = all_vals[name]
        pfx = " " * SIG_W + " │ "
        draw_mid()
        if is_bit(name):
            top, bot = build_wave(vals, a, b)
            nc = M if any(x in name.lower() for x in ["cin","cout","carry","clk"]) else G
            row(f"{nc}{name[:SIG_W]:<{SIG_W}}{N} │ {G}{top}{N}", f"{name[:SIG_W]:<{SIG_W}} │ {top}")
            row(f"{pfx}{G}{bot}{N}", pfx + bot)
        else:
            bus = ""
            for i in range(a, b):
                lab = f"[{to_dec(vals[i])}]"[:SW-1]
                bus += ("╪" if vals[i] != vals[i-1] or i == a else "═") + f"{lab:^{SW-1}}"
            bc = B if any(x in name.lower() for x in ["a","b","c","d","in"]) else R
            row(f"{bc}{name[:SIG_W]:<{SIG_W}}{N} │ {bc}{bus}{N}", f"{name[:SIG_W]:<{SIG_W}} │ {bus}")
draw_bot()

# ── CARD 2: Summary ──
print(); draw_top()
title2 = "SIMULATION RESULTS"
row(f"{Y}{title2.center(IW-1)}{N}", title2.center(IW-1))
draw_mid()

CW = max(5, max(len(n) for n in show) + 1)       # minimum column width
TCW = max(6, max(len(tlabel(t)) for t in times) + 1)
ncols = max(1, (IW - 1 - TCW) // CW)             # max columns per block
for c0 in range(0, len(show), ncols):
    col_sigs = show[c0:c0+ncols]
    cw = (IW - 2 - TCW) // len(col_sigs)         # stretch columns to fill the box
    hdr = f"{'Time':<{TCW}}" + "".join(f"{s:>{cw}}" for s in col_sigs)
    row(f"{W}{hdr}{N}", hdr)
    row(rep("─", IW - 2), rep("─", IW - 2))
    for t in times:
        ns = tlabel(t)
        plain = f"{ns:<{TCW}}"; color = f"{G}{ns:<{TCW}}{N}"
        for s in col_sigs:
            v = to_dec(get_last(s, t))
            plain += f"{str(v):>{cw}}"
            c2 = R if any(x in s.lower() for x in ["sum","out","result","q"]) else W
            color += f"{c2}{str(v):>{cw}}{N}"
        row(color, plain)
    if c0 + ncols < len(show): draw_mid()
draw_bot(); print()
`;

// ---- Missing-tool detection (Alpine package names) ----
// Before a run, each entry is checked inside the terminal. An entry is [what, apk package(s)]:
// "what" is a command name, or an absolute path (starts with "/") that must exist.
// Keyed by language name. Add your own languages here to get the same check.
const DEPS = {
  Python: [["python3", "python3"]],
  C: [["gcc", "gcc"], ["/usr/include/stdio.h", "musl-dev"]],
  "C++": [["g++", "g++"], ["/usr/include/stdio.h", "musl-dev"]],
  Java: [["java", "openjdk21"]],
  TypeScript: [["npx", "nodejs npm"]],
  "React (Vite dev server)": [["npm", "nodejs npm"]],
  Ruby: [["ruby", "ruby"]],
  Go: [["go", "go"]],
  Rust: [["rustc", "rust"]],
  Lua: [["lua5.4", "lua5.4"]],
  Perl: [["perl", "perl"]],
  Shell: [["bash", "bash"]],
  Fortran: [["gfortran", "gfortran"]],
  Haskell: [["runghc", "ghc"]],
  Elixir: [["elixir", "elixir"]],
  OCaml: [["ocaml", "ocaml"]],
  Verilog: [["iverilog", "iverilog"], ["python3", "python3"]],
  SystemVerilog: [["iverilog", "iverilog"], ["python3", "python3"]],
  "SQL (SQLite)": [["sqlite3", "sqlite"]],
  Zig: [["zig", "zig"]],
};
// Python modules that must be importable for a language (wave.py needs "vcd")
const DEPS_MODS = { Verilog: ["vcd"], SystemVerilog: ["vcd"] };
// Extra tools needed when the file runs in VNC mode
const VNC_DEPS = [
  ["Xvnc", "tigervnc"],
  ["websockify", "websockify"],
  [NOVNC_WEB, "novnc"],
  ["openbox", "openbox"],
  ["/usr/share/fonts/dejavu", "font-dejavu"],
];
// Python import name -> how to install it. Unknown names fall back to "pip install <name>".
const PY_PKGS = {
  tkinter: ["apk", "python3-tkinter"], turtle: ["apk", "python3-tkinter"],
  numpy: ["apk", "py3-numpy"], pandas: ["apk", "py3-pandas"], scipy: ["apk", "py3-scipy"],
  matplotlib: ["apk", "py3-matplotlib"], requests: ["apk", "py3-requests"],
  PIL: ["apk", "py3-pillow"], pygame: ["apk", "py3-pygame"], bs4: ["apk", "py3-beautifulsoup4"],
  yaml: ["apk", "py3-yaml"], flask: ["apk", "py3-flask"],
  vcd: ["pip", "pyvcd"], sklearn: ["pip", "scikit-learn"], serial: ["pip", "pyserial"],
  dotenv: ["pip", "python-dotenv"], dateutil: ["pip", "python-dateutil"], jwt: ["pip", "PyJWT"],
  Crypto: ["pip", "pycryptodome"], telebot: ["pip", "pyTelegramBotAPI"], cv2: ["pip", "opencv-python-headless"],
};

// Top-level module names imported by a Python source text
function pythonImports(text) {
  const out = new Set();
  const re = /^[ \t]*(?:from[ \t]+([A-Za-z_]\w*)[\w.]*[ \t]+import\b|import[ \t]+([^\n#;]+))/gm;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) out.add(m[1]);
    else
      m[2].split(",").forEach((part) => {
        const n = part.trim().split(/\s+as\s+/)[0].split(".")[0];
        if (/^[A-Za-z_]\w*$/.test(n)) out.add(n);
      });
  }
  return [...out].slice(0, 40);
}

// Shell snippet: finds what is missing, prints the install commands, asks y/yes (any case) to install.
// Anything else (n, no, Enter) skips the install and the program runs anyway.
function buildPreflight(deps, mods) {
  if (!deps.length && !mods.length) return "";
  let sh = 'a=""; p=""; ';
  deps.forEach(([what, pkg]) => {
    const test = what.startsWith("/") ? `[ -e ${q(what)} ]` : `command -v ${q(what)} >/dev/null 2>&1`;
    sh += `${test} || a="$a ${pkg}"; `;
  });
  if (mods.length) {
    const cases = mods
      .map((mod) => {
        const [kind, pkg] = PY_PKGS[mod] || ["pip", mod];
        return `${mod}) ${kind === "apk" ? "a" : "p"}="$${kind === "apk" ? "a" : "p"} ${pkg}";;`;
      })
      .join(" ");
    sh +=
      `if command -v python3 >/dev/null 2>&1; then ` +
      `m=$(python3 -c "import importlib.util as u,sys;print(' '.join(x for x in sys.argv[1:] if u.find_spec(x) is None))" ${mods.join(" ")} 2>/dev/null); ` +
      `for x in $m; do case $x in ${cases} *) p="$p $x";; esac; done; fi; ` +
      `if [ -n "$p" ]; then command -v pip >/dev/null 2>&1 || a="$a py3-pip"; fi; `;
  }
  sh +=
    `if [ -n "$a$p" ]; then ` +
    `printf '\\nMissing packages. Install with:\\n'; ` +
    `[ -z "$a" ] || printf '  apk add%s\\n' "$a"; ` +
    `[ -z "$p" ] || printf '  pip install --break-system-packages%s\\n' "$p"; ` +
    `printf 'Install now? [y/N] '; read ans; ` +
    `case "$ans" in [yY]|[yY][eE][sS]) ` +
    `[ -z "$a" ] || apk add $a; [ -z "$p" ] || pip install --break-system-packages $p;; ` +
    `*) _pyrun_skip=1; printf 'Skipped. Running anyway...\\n';; esac; fi; `;
  return sh;
}

// The whole script that is written to CMD_PATH and sourced by the terminal.
// - runs the command inside _pyrun_main
// - if the shell's "command not found" handler suggested an `apk add <pkg>`, asks y/N,
//   installs it and runs the program once more
// - removes its own temporary files at the end
function buildScript(dir, userCmd, usesWave) {
  const hook =
    // wrap the shell's own command_not_found_handle (bash only) to keep its message in a file
    `if [ -n "$BASH_VERSION" ] && declare -F command_not_found_handle >/dev/null 2>&1; then ` +
    `eval "$(declare -f command_not_found_handle | sed '1s/command_not_found_handle/_pyrun_cnf/')"; ` +
    `command_not_found_handle() { _pyrun_cnf "$@" 2>&1 | tee /tmp/.pyrun_nf >&2; return 127; }; _pyrun_hook=1; fi; `;
  const retry =
    `if [ $rc -eq 127 ] && [ -z "$_pyrun_skip" ] && [ -s /tmp/.pyrun_nf ]; then ` +
    `e=$(printf '\\033'); ` +
    `pk=$(sed "s/$e\\[[0-9;]*m//g" /tmp/.pyrun_nf | sed -n 's/.*apk add *//p' | head -1 | tr -d '\\r'); ` +
    `case "$pk" in *[!A-Za-z0-9._+\\ -]*) pk="";; esac; ` +
    `if [ -n "$pk" ]; then printf 'Install now (apk add %s)? [y/N] ' "$pk"; read ans; ` +
    `case "$ans" in [yY]|[yY][eE][sS]) ` +
    `if apk add $pk; then rm -f /tmp/.pyrun_nf; printf '\\nRunning again...\\n'; _pyrun_main; rc=$?; fi;; esac; fi; fi; `;
  const unhook =
    `if [ -n "$_pyrun_hook" ]; then ` +
    `eval "$(declare -f _pyrun_cnf | sed '1s/_pyrun_cnf/command_not_found_handle/')"; unset -f _pyrun_cnf; fi; ` +
    `unset -f _pyrun_main; unset _pyrun_hook _pyrun_skip; `;
  return (
    // reset markers: "running" exists while the program runs
    `rm -f ${DONE_PATH} /tmp/.pyrun_nf; _pyrun_skip=""; touch ${FLAG_PATH}; ` +
    // catch Ctrl+C in the shell itself so the cleanup below always runs
    // (the program still receives the signal and stops normally)
    `trap : INT; ` +
    hook +
    // go to the file's folder and run the command
    `_pyrun_main() { cd ${q(dir)} && { ${userCmd}; }; }; ` +
    `_pyrun_main; rc=$?; ` +
    retry +
    unhook +
    // finish: create the "done" marker, remove the "running" marker and the temporary files,
    // print the exit code
    `trap - INT; touch ${DONE_PATH}; rm -f ${FLAG_PATH} ${CMD_PATH}${usesWave ? " " + WAVE_PATH : ""}; ` +
    `printf '\\n[Process finished with exit code %s]\\n' "$rc"\n`
  );
}

const PLACEHOLDERS = ["[FILENAME]", "[NAME]", "[DIR]", "[WAVE]"];

const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`;

// Convert an Acode file URI to a path inside the Alpine terminal
function toTerminalPath(uri) {
  if (uri.includes("com.android.externalstorage.documents")) {
    // Anchor on the authority so only the FIRST "/tree/" or "/document/" counts.
    // A folder named "tree" or "document" deeper in the path can no longer match.
    const m = uri.match(/^content:\/\/[^/]+\/(?:tree|document)\/(.*)$/);
    if (!m) return null;
    let rest = m[1];

    // Standard Android form: <treeId>/document/<docId>
    // (not used when the tree id has the Acode "::" separator)
    const std = rest.match(/^([^/]+)\/document\/(.*)$/);
    if (std && !decodeURIComponent(std[1]).includes("::")) rest = std[2];

    let s = decodeURIComponent(rest);
    if (s.includes("::")) s = s.split("::").pop();
    const i = s.indexOf(":");
    if (i === -1) return null;
    const vol = s.slice(0, i);
    const path = s.slice(i + 1);
    return vol === "primary" ? "/sdcard/" + path : "/storage/" + vol + "/" + path;
  }
  const u = decodeURIComponent(uri);
  if (u.startsWith("file://")) {
    return u.replace(/^file:\/\//, "").replace(/^\/storage\/emulated\/0/, "/sdcard");
  }
  return null;
}

// Quote a string safely for the shell
function q(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fileExt(f) {
  const name = (f && (f.filename || f.name)) || "";
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

function splitExts(str) {
  return String(str || "")
    .split(/[,\s]+/)
    .map((e) => e.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
}

// Convert the old text format ("ext | name | command" per line) to the new list
function migrateOld(text) {
  const out = [];
  String(text || "")
    .split(/\r?\n|\s;;\s/)
    .forEach((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const a = line.indexOf("|");
      const b = a === -1 ? -1 : line.indexOf("|", a + 1);
      if (a === -1 || b === -1) return;
      out.push({
        exts: line.slice(0, a).trim(),
        name: line.slice(a + 1, b).trim(),
        command: line.slice(b + 1).trim(),
      });
    });
  return out;
}

// Add default languages the user does not have yet (matched by extension or name)
function mergeDefaults(current) {
  const usedExts = new Set();
  const usedNames = new Set();
  current.forEach((l) => {
    splitExts(l.exts).forEach((e) => usedExts.add(e));
    usedNames.add(String(l.name || "").toLowerCase());
  });
  DEFAULT_LANGS.forEach((d) => {
    const exts = splitExts(d.exts);
    if (exts.some((e) => usedExts.has(e)) || usedNames.has(d.name.toLowerCase())) return;
    current.push({ ...d });
    exts.forEach((e) => usedExts.add(e));
  });
}

// Drop removed defaults, but only if the user never edited them
function removeObsoleteDefaults(current) {
  for (let i = current.length - 1; i >= 0; i--) {
    const l = current[i] || {};
    const obsolete = REMOVED_DEFAULTS.some(
      (d) =>
        String(l.name || "").trim().toLowerCase() === d.name.toLowerCase() &&
        String(l.command || "").trim() === d.command
    );
    if (obsolete) current.splice(i, 1);
  }
}

class CodeRunner {
  constructor() {
    this.$btn = null;
    this.$style = null;
    this.$mgr = null;
    this.$obs = null;
    this.hosts = [];
    this.term = null;
    this.busy = false;
    this.running = false;
    this.poller = null;
    this.visTimer = null;
    this.warnedTracking = false;
    this.appSettings = acode.require("settings");
    this.checkFile = this.checkFile.bind(this);
    this.place = this.place.bind(this);
  }

  dbg(msg) {
    if (DEBUG) window.toast("[dbg] " + msg, 3500);
  }

  // ---------- Settings (data) ----------

  get store() {
    const all = this.appSettings.value;
    if (!all[PLUGIN_ID]) all[PLUGIN_ID] = {};
    return all[PLUGIN_ID];
  }

  get langs() {
    const s = this.store;
    let changed = false;

    if (!Array.isArray(s.langs)) {
      const old = typeof s.languages === "string" ? migrateOld(s.languages) : [];
      s.langs = old.length ? old : DEFAULT_LANGS.map((l) => ({ ...l }));
      delete s.languages;
      changed = true;
    }
    if (s.defaultsVersion !== DEFAULTS_VERSION) {
      removeObsoleteDefaults(s.langs);
      mergeDefaults(s.langs);
      s.defaultsVersion = DEFAULTS_VERSION;
      changed = true;
    }
    if (changed) this.save();
    return s.langs;
  }

  setLangs(list) {
    this.store.langs = list;
    this.save();
    this.checkFile();
  }

  save() {
    try {
      this.appSettings.update(false, false);
    } catch (e) {
      try { this.appSettings.update(false); } catch (e2) {}
    }
  }

  // Only complete entries (extension + command) are usable
  getLanguage(file) {
    const ext = fileExt(file);
    if (!ext) return null;
    return (
      this.langs.find(
        (l) => l && l.command && l.command.trim() && splitExts(l.exts).includes(ext)
      ) || null
    );
  }

  // One entry on the settings page. If inline embedding fails, tapping it opens a separate page.
  get settingsObject() {
    return {
      list: [{ key: "manage", text: ITEM_TITLE, info: ITEM_INFO }],
      cb: (key) => {
        if (key === "manage") this.openManager();
      },
    };
  }

  // ---------- Language list UI (collapsible cards) ----------

  buildManager(host) {
    host.innerHTML = `
      <div class="pm-bar">
        <div class="pm-bar-title">${ITEM_TITLE}</div>
        <div class="pm-add">+ Add</div>
      </div>
      <div class="pm-help">
        Placeholders for commands: <b>[FILENAME]</b> file path,
        <b>[NAME]</b> name without extension, <b>[DIR]</b> folder.
        Open a card and tap a chip to insert it into the command.
      </div>
      <div class="pm-list"></div>
      <div class="pm-reset">Reset to defaults</div>
    `;

    const list = host.querySelector(".pm-list");

    // Read all cards and save them to settings
    let saveTimer = null;
    const collect = () => {
      const out = [];
      list.querySelectorAll(".pm-card").forEach((card) => {
        const name = card.querySelector(".pm-name").value.trim();
        const exts = card.querySelector(".pm-exts").value.trim();
        const command = card.querySelector(".pm-cmd").value.trim();
        if (!name && !exts && !command) return; // skip completely empty cards
        out.push({ name, exts, command });
      });
      return out;
    };
    const flush = () => {
      clearTimeout(saveTimer);
      this.setLangs(collect());
    };
    const saveSoon = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 350);
    };
    // Save whenever focus leaves an input
    host.addEventListener("focusout", flush);

    const grow = (ta) => {
      ta.style.height = "auto";
      ta.style.height = Math.max(64, ta.scrollHeight) + "px";
    };

    const extsLabel = (str) =>
      splitExts(str).map((e) => "." + e).join(" ") || "-";

    const makeCard = (lang, expanded) => {
      const card = document.createElement("div");
      card.className = "pm-card" + (expanded ? "" : " collapsed");
      card.innerHTML = `
        <div class="pm-card-head">
          <span class="pm-arrow">${ICON_CHEVRON}</span>
          <span class="pm-card-title"></span>
          <span class="pm-card-exts"></span>
        </div>
        <div class="pm-card-body">
          <div class="pm-row">
            <div class="pm-field pm-grow">
              <label>Name</label>
              <input class="pm-name" type="text" placeholder="Python" autocomplete="off" spellcheck="false">
            </div>
            <div class="pm-field pm-extw">
              <label>Extensions</label>
              <input class="pm-exts" type="text" placeholder="py" autocomplete="off" spellcheck="false" autocapitalize="off">
            </div>
          </div>
          <div class="pm-field">
            <label>Command</label>
            <textarea class="pm-cmd" rows="2" placeholder="python3 -u [FILENAME]" autocomplete="off" spellcheck="false" autocapitalize="off"></textarea>
          </div>
          <div class="pm-foot">
            <div class="pm-chips"></div>
            <div class="pm-del">Delete</div>
          </div>
        </div>
      `;

      const headEl = card.querySelector(".pm-card-head");
      const titleEl = card.querySelector(".pm-card-title");
      const extsTag = card.querySelector(".pm-card-exts");
      const nameEl = card.querySelector(".pm-name");
      const extsEl = card.querySelector(".pm-exts");
      const cmdEl = card.querySelector(".pm-cmd");

      nameEl.value = lang.name || "";
      extsEl.value = lang.exts || "";
      cmdEl.value = lang.command || "";

      const refreshHead = () => {
        titleEl.textContent = nameEl.value.trim() || "New language";
        extsTag.textContent = extsLabel(extsEl.value);
      };
      refreshHead();

      // Expand / collapse
      headEl.addEventListener("click", () => {
        card.classList.toggle("collapsed");
        if (!card.classList.contains("collapsed")) setTimeout(() => grow(cmdEl), 0);
      });

      [nameEl, extsEl].forEach((el) =>
        el.addEventListener("input", () => {
          refreshHead();
          saveSoon();
        })
      );
      cmdEl.addEventListener("input", () => {
        grow(cmdEl);
        saveSoon();
      });

      // Placeholder chips
      const chips = card.querySelector(".pm-chips");
      PLACEHOLDERS.forEach((ph) => {
        const chip = document.createElement("span");
        chip.className = "pm-chip";
        chip.textContent = ph;
        chip.addEventListener("pointerdown", (e) => e.preventDefault()); // keep keyboard open
        chip.addEventListener("click", () => {
          const s = cmdEl.selectionStart ?? cmdEl.value.length;
          const e = cmdEl.selectionEnd ?? s;
          cmdEl.value = cmdEl.value.slice(0, s) + ph + cmdEl.value.slice(e);
          cmdEl.focus();
          cmdEl.setSelectionRange(s + ph.length, s + ph.length);
          cmdEl.dispatchEvent(new Event("input"));
        });
        chips.appendChild(chip);
      });

      // Two taps to delete
      const del = card.querySelector(".pm-del");
      let delTimer = null;
      del.addEventListener("click", () => {
        if (del.classList.contains("sure")) {
          clearTimeout(delTimer);
          card.remove();
          flush();
          refreshEmpty();
        } else {
          del.classList.add("sure");
          del.textContent = "Tap again";
          delTimer = setTimeout(() => {
            del.classList.remove("sure");
            del.textContent = "Delete";
          }, 2200);
        }
      });

      if (expanded) setTimeout(() => grow(cmdEl), 0);
      return card;
    };

    const empty = document.createElement("div");
    empty.className = "pm-empty";
    empty.textContent = "No languages yet. Tap + Add above.";
    const refreshEmpty = () => {
      if (!list.querySelector(".pm-card")) list.appendChild(empty);
      else if (empty.parentNode) empty.remove();
    };

    const render = (items) => {
      list.innerHTML = "";
      items.forEach((l) => list.appendChild(makeCard(l, false)));
      refreshEmpty();
    };
    render(this.langs);

    // + Add
    host.querySelector(".pm-add").addEventListener("click", () => {
      if (empty.parentNode) empty.remove();
      const card = makeCard({ name: "", exts: "", command: "" }, true);
      list.appendChild(card);
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => card.querySelector(".pm-name").focus(), 250);
    });

    // Reset
    const resetBtn = host.querySelector(".pm-reset");
    let resetTimer = null;
    resetBtn.addEventListener("click", () => {
      if (resetBtn.classList.contains("sure")) {
        clearTimeout(resetTimer);
        resetBtn.classList.remove("sure");
        resetBtn.textContent = "Reset to defaults";
        const fresh = DEFAULT_LANGS.map((l) => ({ ...l }));
        render(fresh);
        this.store.defaultsVersion = DEFAULTS_VERSION;
        this.setLangs(fresh);
      } else {
        resetBtn.classList.add("sure");
        resetBtn.textContent = "This restores all defaults. Tap again to confirm";
        resetTimer = setTimeout(() => {
          resetBtn.classList.remove("sure");
          resetBtn.textContent = "Reset to defaults";
        }, 2500);
      }
    });

    return { flush };
  }

  // ---------- Embed the list inside the plugin settings page ----------

  watchSettings() {
    this.$obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.closest && n.closest(".pm-inline, .pm-root")) continue;
          if (n.classList && (n.classList.contains("pm-inline") || n.classList.contains("pyrun-btn"))) continue;
          this.tryEmbed(n);
        }
      }
    });
    this.$obs.observe(document.body, { childList: true, subtree: true });
  }

  tryEmbed(node) {
    try {
      const text = node.textContent || "";
      if (text.length > 4000) return;
      if (!text.includes(ITEM_TITLE) || !text.includes(ITEM_INFO)) return;
      if (node.querySelector && node.querySelector(".pm-inline")) return;

      // Find the text node of the row title
      const tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let tn = null;
      while ((tn = tw.nextNode())) {
        if (tn.nodeValue.trim() === ITEM_TITLE) break;
      }
      if (!tn || !tn.parentElement) return;

      const item =
        tn.parentElement.closest("[data-key], .list-item, li") ||
        tn.parentElement.parentElement;
      if (!item || !item.parentNode || item.dataset.pmDone) return;
      item.dataset.pmDone = "1";

      const host = document.createElement("div");
      host.className = "pm-inline";
      item.parentNode.insertBefore(host, item);
      item.style.display = "none";

      try {
        const mgr = this.buildManager(host);
        this.hosts.push(mgr);
        this.dbg("embedded in settings page");
      } catch (e) {
        host.remove();
        item.style.display = "";
        this.dbg("embed failed: " + (e && e.message ? e.message : e));
      }
    } catch (e) {
      this.dbg("embed error: " + (e && e.message ? e.message : e));
    }
  }

  // ---------- Separate page (fallback) ----------

  openManager() {
    if (this.$mgr) return;

    const root = document.createElement("div");
    root.className = "pm-root";
    root.innerHTML = `
      <div class="pm-head">
        <div class="pm-back">${ICON_BACK}</div>
        <div class="pm-title">${ITEM_TITLE}</div>
      </div>
      <div class="pm-body"></div>
    `;
    document.body.appendChild(root);
    this.$mgr = root;

    const mgr = this.buildManager(root.querySelector(".pm-body"));

    const close = () => {
      mgr.flush();
      try {
        acode.require("actionStack").remove("pyrun-manager");
      } catch (e) {}
      root.remove();
      this.$mgr = null;
    };
    root.querySelector(".pm-back").addEventListener("click", close);

    // Handle the phone's back button
    try {
      acode.require("actionStack").push({ id: "pyrun-manager", action: close });
    } catch (e) {}
  }

  // ---------- Run button ----------

  buildButton() {
    this.$style = document.createElement("style");
    this.$style.textContent = `
      .pyrun-btn{
        position:fixed;z-index:999;
        width:${BTN_SIZE}px;height:${BTN_SIZE}px;border-radius:50%;
        display:none;align-items:center;justify-content:center;
        cursor:pointer;user-select:none;-webkit-user-select:none;
        touch-action:manipulation;-webkit-tap-highlight-color:transparent;
        color:var(--primary-text-color,#222);
        transition:background .15s ease, transform .1s ease;
      }
      .pyrun-btn:hover{background:rgba(128,128,128,.25);}
      .pyrun-btn:active{transform:scale(.9);background:rgba(128,128,128,.35);}
      .pyrun-btn svg{width:24px;height:24px;fill:currentColor;pointer-events:none;}
      .pyrun-btn.running{color:#e5484d;}

      /* ---- Separate page (fallback) ---- */
      .pm-root{
        position:fixed;left:0;top:0;right:0;bottom:0;z-index:10000;
        display:flex;flex-direction:column;
        background:var(--secondary-color,#f5f5f5);
        color:var(--primary-text-color,#222);
      }
      .pm-head{
        display:flex;align-items:center;gap:6px;flex-shrink:0;
        height:56px;padding:0 10px;
        background:var(--primary-color,#3771a1);
        color:var(--primary-text-color,#fff);
        box-shadow:0 1px 4px rgba(0,0,0,.25);
      }
      .pm-back{
        width:40px;height:40px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;cursor:pointer;
      }
      .pm-back:active{background:rgba(128,128,128,.3);}
      .pm-back svg{width:24px;height:24px;fill:currentColor;}
      .pm-title{flex:1;font-size:18px;font-weight:600;}
      .pm-body{flex:1;overflow-y:auto;padding:12px 12px 80px;-webkit-overflow-scrolling:touch;}
      .pm-root .pm-bar-title{opacity:0;}

      /* ---- Inside the settings page ---- */
      .pm-inline{padding:8px 12px 24px;color:var(--primary-text-color,inherit);}

      /* ---- Language list ---- */
      .pm-bar{
        display:flex;align-items:center;justify-content:space-between;
        margin:4px 2px 8px;
      }
      .pm-bar-title{font-size:16px;font-weight:600;}
      .pm-add{
        padding:8px 16px;border-radius:18px;font-weight:600;cursor:pointer;
        background:rgba(128,128,128,.2);
      }
      .pm-add:active{background:rgba(128,128,128,.4);}
      .pm-help{font-size:12.5px;line-height:1.5;opacity:.75;margin:2px 4px 12px;}
      .pm-card{
        background:var(--popup-background-color,rgba(255,255,255,.06));
        border:1px solid var(--border-color,rgba(128,128,128,.35));
        border-radius:12px;padding:10px 12px;margin-bottom:10px;
      }
      .pm-card-head{
        display:flex;align-items:center;gap:10px;cursor:pointer;
        min-height:34px;-webkit-tap-highlight-color:transparent;
      }
      .pm-arrow{width:14px;height:14px;opacity:.7;transition:transform .15s ease;flex-shrink:0;}
      .pm-arrow svg{width:14px;height:14px;fill:currentColor;display:block;}
      .pm-card:not(.collapsed) .pm-arrow{transform:rotate(90deg);}
      .pm-card-title{
        flex:1;min-width:0;font-weight:600;font-size:15px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      }
      .pm-card-exts{
        font-family:monospace;font-size:12px;padding:3px 8px;border-radius:10px;
        background:rgba(128,128,128,.2);flex-shrink:0;
      }
      .pm-card-body{margin-top:12px;}
      .pm-card.collapsed .pm-card-body{display:none;}
      .pm-row{display:flex;gap:10px;}
      .pm-grow{flex:1;min-width:0;}
      .pm-extw{width:36%;min-width:0;}
      .pm-field{margin-bottom:10px;}
      .pm-field label{display:block;font-size:11.5px;opacity:.65;margin:0 2px 4px;}
      .pm-card input,.pm-card textarea{
        width:100%;box-sizing:border-box;padding:9px 10px;
        border:1px solid var(--border-color,rgba(128,128,128,.4));
        border-radius:8px;outline:none;font-size:14px;
        background:var(--secondary-color,rgba(255,255,255,.08));
        color:var(--primary-text-color,#222);
      }
      .pm-card textarea{
        font-family:monospace;resize:none;overflow:hidden;min-height:64px;
      }
      .pm-card input:focus,.pm-card textarea:focus{
        border-color:var(--active-color,#3771a1);
      }
      .pm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;}
      .pm-chips{display:flex;flex-wrap:wrap;gap:6px;}
      .pm-chip{
        font-size:11.5px;font-family:monospace;padding:4px 8px;border-radius:12px;
        background:rgba(128,128,128,.2);cursor:pointer;
      }
      .pm-chip:active{background:rgba(128,128,128,.4);}
      .pm-del{
        font-size:13px;padding:6px 12px;border-radius:14px;cursor:pointer;
        color:#e5484d;flex-shrink:0;
      }
      .pm-del:active{background:rgba(229,72,77,.15);}
      .pm-del.sure{background:#e5484d;color:#fff;}
      .pm-empty{text-align:center;opacity:.6;padding:30px 10px;font-size:14px;}
      .pm-reset{
        text-align:center;font-size:13px;padding:12px;margin-top:6px;
        opacity:.7;cursor:pointer;border-radius:10px;
      }
      .pm-reset.sure{opacity:1;color:#e5484d;}
    `;
    document.head.appendChild(this.$style);

    const btn = document.createElement("div");
    btn.className = "pyrun-btn";
    btn.innerHTML = ICON_PLAY;
    btn.addEventListener("click", () => this.onButton());
    document.body.appendChild(btn);
    this.$btn = btn;

    this.place();
    window.addEventListener("resize", this.place);
  }

  // Vertically centered in the header, RIGHT_OFFSET px from the right edge
  place() {
    if (!this.$btn) return;
    const header =
      (window.editorManager && editorManager.header) ||
      document.querySelector("header");
    const r = header ? header.getBoundingClientRect() : null;

    let top = 50;
    if (r && r.height > 20) {
      top = r.top + (r.height - BTN_SIZE) / 2;
    }
    top += TOP_ADJUST;

    this.$btn.style.left = window.innerWidth - RIGHT_OFFSET + "px";
    this.$btn.style.top = Math.max(0, top) + "px";
  }

  setRunning(on) {
    this.running = on;
    if (!this.$btn) return;
    this.$btn.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    this.$btn.classList.toggle("running", on);
    if (on) this.startPolling();
    else this.stopPolling();
  }

  // ---------- Button visibility ----------

  // True when the code editor is the page the user is actually looking at.
  // True when the main editor header is the top layer at the button's position.
  // A plugin page, dialog or sidebar covering the screen puts a different element there.
  isEditorVisible() {
    this.lastHit = "n/a";
    try {
      const em = window.editorManager;
      const hdr =
        (em && em.header instanceof Element && em.header) ||
        document.querySelector("header");
      if (!hdr || !this.$btn) return true; // unknown layout: do not hide the button

      // Probe the point where the button sits, ignoring the button itself
      const cx = (parseFloat(this.$btn.style.left) || 0) + BTN_SIZE / 2;
      const cy = (parseFloat(this.$btn.style.top) || 0) + BTN_SIZE / 2;
      const stack = document
        .elementsFromPoint(cx, cy)
        .filter((el) => el !== this.$btn && !this.$btn.contains(el));
      const top = stack[0];
      if (!top) return true;

      // Kept for the debug toast
      this.lastHit =
        top.tagName.toLowerCase() +
        (top.className ? "." + String(top.className).split(" ")[0] : "");

      return hdr.contains(top);
    } catch (e) {
      return true; // if the check itself fails, do not hide the button
    }
  }

  // Show the button only for a supported file while the editor is visible
  refreshVisibility() {
    if (!this.$btn || document.hidden) return;
    const show = !!this.getLanguage(editorManager.activeFile) && this.isEditorVisible();
    const wasShown = this.$btn.style.display === "flex";
    if (show === wasShown) return;
    this.$btn.style.display = show ? "flex" : "none";
    if (show) this.place();
    this.dbg("button " + (show ? "shown" : "hidden") + ", top element: " + this.lastHit);
  }

  // ---------- Detect when the program has finished ----------

  // Delete both marker files so a stale marker cannot confuse the next run
  async clearMarkers() {
    try {
      const fsOperation = acode.require("fsOperation");
      for (const url of [FLAG_URL, DONE_URL, VNC_READY_URL]) {
        try {
          const f = fsOperation(url);
          if (await f.exists()) await f.delete();
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Show the tracking warning only once per session
  warnTracking() {
    if (this.warnedTracking) return;
    this.warnedTracking = true;
    window.toast("Cannot track program state. Is /sdcard available in the terminal?", 4500);
  }

  startPolling() {
    this.stopPolling();
    const startedAt = Date.now();
    let seen = false; // the "running" marker was seen at least once

    this.poller = setInterval(async () => {
      if (!this.running) return;

      // The terminal tab was closed
      try {
        const terminal = acode.require("terminal");
        if (this.term && terminal && typeof terminal.get === "function") {
          if (!terminal.get(this.term.id)) {
            this.setRunning(false);
            return;
          }
        }
      } catch (e) {}

      try {
        const fsOperation = acode.require("fsOperation");

        // The "done" marker is created when the command ends, even for very fast programs
        if (await fsOperation(DONE_URL).exists()) {
          this.setRunning(false);
          try { await fsOperation(DONE_URL).delete(); } catch (e) {}
          return;
        }

        if (await fsOperation(FLAG_URL).exists()) {
          seen = true;
        } else if (seen) {
          // The running marker disappeared without a done marker
          this.setRunning(false);
        } else if (Date.now() - startedAt > NO_MARKER_TIMEOUT) {
          // No marker ever appeared, so the state cannot be tracked
          this.warnTracking();
          this.setRunning(false);
        }
      } catch (e) {
        this.dbg("marker check failed: " + (e && e.message ? e.message : e));
        this.setRunning(false);
      }
    }, 700);
  }

  stopPolling() {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }

  // ---------- Button actions ----------

  async onButton() {
    if (this.running) {
      await this.stop();
    } else {
      await this.run();
    }
  }

  async stop() {
    try {
      const terminal = acode.require("terminal");
      if (terminal && this.term) {
        terminal.write(this.term.id, "\x03"); // Ctrl+C
      }
    } catch (e) {}
    this.setRunning(false);
  }

  checkFile() {
    // The header may change after a file switch, so wait a bit before positioning
    setTimeout(() => {
      this.refreshVisibility();
      if (this.$btn && this.$btn.style.display === "flex") this.place();
    }, 250);
  }

  // ---------- Plugin startup ----------

  async init() {
    this.buildButton();
    this.watchSettings();
    editorManager.on("switch-file", this.checkFile);
    editorManager.on("rename-file", this.checkFile);
    setTimeout(this.checkFile, 600);

    // Keep the button in sync when pages, dialogs or the sidebar open and close
    this.visTimer = setInterval(() => this.refreshVisibility(), VISIBILITY_POLL);

    // Also reachable from the command palette
    try {
      editorManager.editor.commands.addCommand({
        name: "pyrun-languages",
        description: "Code Runner: Languages & commands",
        bindKey: null,
        exec: () => this.openManager(),
      });
    } catch (e) {}
  }

  // Returns fresh=true when a new terminal was created, false when reusing one
  async getTerminal(terminal) {
    if (this.term && typeof terminal.get === "function") {
      try {
        if (terminal.get(this.term.id)) return { t: this.term, fresh: false };
      } catch (e) {}
    }
    this.term = await terminal.create({ name: "Runner" });
    // A new terminal needs a moment to start
    await sleep(1200);
    return { t: this.term, fresh: true };
  }

  // Get the file text: the editor's own copy first (fast, no disk access), disk as fallback
  async readText(file) {
    try {
      const d = file.session && file.session.doc;
      if (d && typeof d.toString === "function") {
        const t = d.toString();
        if (typeof t === "string" && t.length) return t;
      }
    } catch (e) {}
    try {
      const t = await acode.require("fsOperation")(file.uri).readFile("utf8");
      return typeof t === "string" ? t : new TextDecoder().decode(t);
    } catch (e) {
      this.dbg("read failed: " + (e && e.message ? e.message : e));
      return "";
    }
  }

  // Write a file to shared storage (the terminal sees it under /sdcard). Returns true on success.
  async writeShared(name, content) {
    try {
      const fsOperation = acode.require("fsOperation");
      const f = fsOperation(WAVE_DIR_URL + name);
      if (await f.exists()) await f.writeFile(content);
      else await fsOperation(WAVE_DIR_URL).createFile(name, content);
      return true;
    } catch (e) {
      this.dbg(name + " write failed: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // The bundled wave.py, so [WAVE] works
  async ensureWave() {
    await this.writeShared(WAVE_NAME, WAVE_PY);
  }

  // Does this file need the VNC viewer?
  async wantsVnc(file) {
    const text = await this.readText(file);
    const marker = VNC_MARKER.test(text);
    const gui = GUI_IMPORT.test(text);
    this.dbg("vnc check: len=" + text.length + " marker=" + marker + " gui=" + gui);
    return marker || gui;
  }

  // Wait for the "ready" marker from the terminal, then open the viewer (no fixed delay)
  async waitVnc() {
    const fsOperation = acode.require("fsOperation");
    const t0 = Date.now();
    while (Date.now() - t0 < VNC_WAIT_MAX) {
      try {
        const f = fsOperation(VNC_READY_URL);
        if (await f.exists()) {
          try { await f.delete(); } catch (e) {}
          this.dbg("vnc ready after " + (Date.now() - t0) + " ms");
          break;
        }
      } catch (e) {}
      await sleep(150);
    }
    this.openVnc();
  }

  // Open the noVNC page in Acode's built-in browser
  openVnc() {
    try {
      const theme = acode.require("themes").get(acode.require("settings").value.appTheme).toJSON("hex");
      cordova.exec(() => {}, (e) => this.dbg("browser error: " + e), "Browser", "open", [NOVNC_URL, theme, false]);
      this.dbg("browser opened");
      return;
    } catch (e) {
      this.dbg("browser open failed: " + (e && e.message ? e.message : e));
    }
    try {
      cordova.InAppBrowser.open(NOVNC_URL, "_blank", "location=yes");
    } catch (e) {
      window.open(NOVNC_URL, "_blank");
    }
  }

  // Replace placeholders in the command
  buildUserCommand(lang, path, dir) {
    const base = path.substring(path.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    const nameNoExt = dot > 0 ? base.slice(0, dot) : base;
    return lang.command
      .trim()
      .replace(/;+$/, "") // a trailing ";" would break the "{ cmd; }" wrapper
      .replace(/\[FILENAME\]/g, () => q(path))
      .replace(/\[NAME\]/g, () => q(nameNoExt))
      .replace(/\[DIR\]/g, () => q(dir))
      .replace(/\[WAVE\]/g, () => q(WAVE_PATH));
  }

  async run() {
    if (this.busy) return;

    const file = editorManager.activeFile;
    if (!file || !file.uri) {
      window.toast("Please save the file first", 2000);
      return;
    }

    const lang = this.getLanguage(file);
    if (!lang) {
      window.toast("No language is configured for this file", 3000);
      return;
    }

    if (file.isUnsaved) await file.save();

    const path = toTerminalPath(file.uri);
    if (!path) {
      window.toast("Cannot map file path. Only shared storage or SD card files are supported", 3500);
      return;
    }

    const dir = path.substring(0, path.lastIndexOf("/")) || "/";
    let userCmd = this.buildUserCommand(lang, path, dir);
    const vnc = await this.wantsVnc(file);
    if (vnc) userCmd = VNC_PREP + userCmd;
    if (lang.command.includes("[WAVE]")) await this.ensureWave();

    // Check for missing tools / packages first (asks before installing)
    const deps = [...(DEPS[lang.name] || []), ...(vnc ? VNC_DEPS : [])];
    let mods = DEPS_MODS[lang.name] || [];
    if (lang.name === "Python") mods = pythonImports(await this.readText(file));
    userCmd = buildPreflight(deps, mods) + userCmd;
    this.dbg(lang.name + ": " + userCmd);

    this.busy = true;
    try {
      const terminal = acode.require("terminal");
      if (!terminal) {
        window.toast("Terminal API not found", 3000);
        return;
      }

      const { t, fresh } = await this.getTerminal(terminal);

      // If a program is still running, stop it (Ctrl+C) and clear the input line (Ctrl+U)
      if (!fresh) {
        terminal.write(t.id, "\x03");
        await sleep(250);
        terminal.write(t.id, "\x15");
        await sleep(100);
      }

      // Remove stale markers from a previous run
      await this.clearMarkers();

      // The long part goes into a script file, so only a short line is typed into the terminal
      // (long lines can exceed the terminal's 4096 character limit and also flash on screen)
      const body = buildScript(dir, userCmd, lang.command.includes("[WAVE]"));
      const viaFile = await this.writeShared(CMD_NAME, body);

      const cmd =
        // hide the prompt
        `PS1=''; PROMPT_COMMAND=''; ` +
        // clear the screen
        `printf '\\033[2J\\033[3J\\033[H'; ` +
        (viaFile ? `. ${CMD_PATH}\r` : body.replace(/\n$/, "\r"));

      terminal.write(t.id, cmd);
      this.setRunning(true);
      if (vnc) this.waitVnc();
    } catch (e) {
      window.toast("Terminal error: " + (e && e.message ? e.message : e), 5000);
    } finally {
      this.busy = false;
    }
  }

  destroy() {
    this.stopPolling();
    if (this.visTimer) {
      clearInterval(this.visTimer);
      this.visTimer = null;
    }
    if (this.$obs) this.$obs.disconnect();
    this.hosts.forEach((h) => {
      try { h.flush(); } catch (e) {}
    });
    this.hosts = [];
    window.removeEventListener("resize", this.place);
    if (this.$mgr) this.$mgr.remove();
    if (this.$btn) this.$btn.remove();
    if (this.$style) this.$style.remove();
    try {
      editorManager.editor.commands.removeCommand("pyrun-languages");
    } catch (e) {}
    editorManager.off("switch-file", this.checkFile);
    editorManager.off("rename-file", this.checkFile);
  }
}

if (window.acode) {
  const runner = new CodeRunner();
  acode.setPluginInit(
    PLUGIN_ID,
    async () => {
      await runner.init();
    },
    runner.settingsObject
  );
  acode.setPluginUnmount(PLUGIN_ID, () => {
    runner.destroy();
  });
}