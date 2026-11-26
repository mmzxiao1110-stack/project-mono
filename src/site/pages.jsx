/** About, News, Download and Help: each in its own colour (see PAGES in kit.jsx). */
import { useEffect, useState } from "react";
import { SiteShell, Title, Panel, glass, glassFill } from "./kit.jsx";
import { RULES } from "../../shared/rules.js";

const px = (n) => `calc(var(--p) * ${n})`;
const H = ({ children }) => <div className="tb-t tb-b" style={{ color: "var(--tb-you)", margin: `${px(2)} 0 ${px(4)}` }}>{children}</div>;
const Dim = ({ children }) => <span style={{ color: "var(--tb-dim)" }}>{children}</span>;
const Stack = ({ children }) => <div className="flex flex-col" style={{ gap: px(5) }}>{children}</div>;

function PlayButton({ label = "PLAY NOW" }) {
  return (
    <div className="flex justify-center" style={{ marginTop: px(6) }}>
      <a href="/" className="tb-t no-underline flex items-center justify-center" style={{ height: px(20), padding: `0 ${px(10)}`, color: "var(--tb-text)", ...glassFill("var(--tb-you)") }}>{label}</a>
    </div>
  );
}

/* ============================================================
   ABOUT — cream
   ============================================================ */
export function About() {
  return (
    <SiteShell page="about">
      <Title text="ABOUT" sub="A territory game for two, played at the same time." />
      <Stack>
        <Panel>
          <H>WHAT IS TESELLA?</H>
          <div className="tb-t tb-prose">
            <p>Tesella is a two-player game on a {RULES.size}×{RULES.size} board of glass squares. Each turn you both get the same piece, and you both choose a move in secret. The moves land together.</p>
            <p>Whoever covers more of the board after {RULES.turns} turns wins. The four centre squares count double.</p>
          </div>
        </Panel>
        <Panel>
          <H>A TURN</H>
          <div className="tb-t tb-prose">
            <p><Dim>PLACE</Dim> your piece touching your own squares (corners count).</p>
            <p><Dim>DELETE</Dim>: stamp your piece anywhere and wipe what's under it. But every turn you delete gives your opponent a pin charge.</p>
            <p><Dim>PIN</Dim>: with a charge, switch PIN on and the piece you place can't be deleted.</p>
            <p>Grab the same square at the same moment and it stays empty. Fill a whole row or column and it clears, pins and all.</p>
          </div>
        </Panel>
        <Panel>
          <H>TIES</H>
          <div className="tb-t tb-prose">
            <p>Level after {RULES.turns} turns? Overtime: the board's outer ring goes dark, and again every {RULES.overtimeEvery} turns, until someone leads. Down to the centre 2×2, those four squares decide it.</p>
          </div>
        </Panel>
        <Panel>
          <H>WAYS TO PLAY</H>
          <div className="tb-t tb-prose">
            <p><Dim>RANKED</Dim>: rated matches with a TR and a rank from F to X.</p>
            <p><Dim>UNRANKED</Dim>: quick games against anyone; guests welcome.</p>
            <p><Dim>PRIVATE</Dim>: send a friend a room code.</p>
            <p><Dim>SINGLE PLAYER</Dim>: against the AI, strength 1 to 10.</p>
            <p><Dim>MARATHON</Dim>: alone on a 7×7 board, for a high score. Three pieces at a time; clear rows and columns to keep going.</p>
            <p><Dim>TURN BASED</Dim>: two players, one device, a 7×7 board, one move each in turn.</p>
          </div>
        </Panel>
        <Panel>
          <H>CREDITS</H>
          <div className="tb-t tb-prose">
            <p>Type: Silkscreen by Jason Kottke, under the SIL Open Font License. Every sound and every note of music is made live in your browser.</p>
          </div>
        </Panel>
      </Stack>
      <PlayButton />
    </SiteShell>
  );
}

/* ============================================================
   NEWS — sea green
   ============================================================ */
const NEWS = [
  { v: "v0.37.0", date: "NOV 2026", title: "PROFILE CARDS, RANK LETTERS", items: [
    "Your profile card: your picture and big Blitz, Sprint and Ultra cards breaking out of a little dithered sky. Pick its sky, accent and pattern (waves, stars, bubbles or a grid) on your account page.",
    "Ranks are big shaded pixel letters now, with their + and −.",
    "Titles are plain white.",
  ] },
  { v: "v0.36.0", date: "NOV 2026", title: "STRONGER BOTS", items: [
    "VS BOT skill 10 is a new bot found by simulation: it looks three placements ahead, hunts combos, keeps its board open and plans for the junk it sees coming. It beat the old skill 10 by 17 to 4.",
    "VS AI strength 10 now plays Control's turns as what they are, simultaneous: it predicts your likely move and picks what holds up best against it. It beat the old top level 42 to 18.",
  ] },
  { v: "v0.35.0", date: "NOV 2026", title: "RANKED LOBBIES, MATCH INTROS, PROFILE CARDS", items: [
    "BLITZ and CONTROL each have their own lobby: your rank, your Glicko, who's playing and searching, and one big PLAY. Keep searching while you change settings or themes.",
    "A match found: a sonar ping, the tide, you and your opponent either side of a wave (click them to see their profile), then 3-2-1.",
    "Every game mode starts on the tide and counts down 3-2-1; Sprint and Ultra clocks start at GO.",
    "Profile cards in your own colours, with Blitz PPS, APM and VS. Full stats on T-Terminal.",
    "New mode colours; unranked play is gone (private rooms stay). Titles are now bold type.",
    "Replays: big boards and the controls at the bottom, the same for every mode.",
    "Rank emblems drawn as pixel art, from a plain F plate to a shining X diamond.",
    "How to Play: Control, Blitz, Sprint · Ultra and Marathon, each with its own pages.",
    "Sprint and Ultra start straight after the tide (the clock starts on your first move); VS BOT and VS AI count down.",
  ] },
  { v: "v0.34.0", date: "NOV 2026", title: "REPLAYS YOU CAN HEAR AND SAVE", items: [
    "Replays play the game's sounds, and the menu music fades out while you watch.",
    "SAVE VIDEO: Sprint, Ultra, Marathon and Blitz replays can be saved as a video with sound.",
    "In replays the next pieces sit right against the board, like your two pieces.",
    "A new icon with a clear background.",
  ] },
  { v: "v0.33.0", date: "NOV 2026", title: "BLITZ REPLAYS, NEW END SCREENS", items: [
    "Blitz and VS BOT matches are saved in REPLAYS with both boards and the real time of every piece and every junk drop.",
    "Blitz boards are laid out like Sprint: a piece and your stats on the left, a piece and the forecast on the right, for both players.",
    "Sprint, Ultra, Marathon, Blitz and VS BOT now end with the same wave and result screen as a Control match; Blitz shows your rating change.",
    "How to Play has a Blitz section: spikes, the attack table and junk.",
  ] },
  { v: "v0.13.0", date: "NOV 2026", title: "CALMER PLAY SCREEN, ONE ACCOUNT PAGE", items: [
    "PLAY: offline modes on the left, online on the right, clear glass cards, no more falling specks.",
    "Your account page now holds your ranked stats and your Marathon best.",
    "Menu: theme, replays, how to play and settings in one even row.",
    "Fixed: a Marathon piece near the edge no longer shows up on the far side of the board.",
  ] },
  { v: "v0.12.0", date: "NOV 2026", title: "A DREAMIER PLAY SCREEN", items: [
    "PLAY is a little night sky over the sea: stars, shooting stars, light rays and bubbles, with floating glass cards.",
    "Marathon: leave whenever you like and pick up where you left off (signed in).",
    "Marathon uses your keys: Q / E turn, Space drops the piece where its shadow is.",
    "Fixed: the shadow piece no longer shows on the board when the pointer is beside it.",
  ] },
  { v: "v0.11.0", date: "NOV 2026", title: "A NEW PLAY SCREEN", items: [
    "PLAY opens a new screen: Marathon and Ranked up top, Turn Based, Private, Unranked and VS AI below.",
    "Marathon pieces can be turned: R, the turn button, or tap a picked piece.",
    "Your account sits on the menu; the small button is now sound on/off.",
    "The menu music plays from its beginning.",
  ] },
  { v: "v0.10.0", date: "NOV 2026", title: "MARATHON AND TURN BASED", items: [
    "One big PLAY button: ranked, unranked, private, Marathon and Turn Based in one place.",
    "Marathon: a solo high-score mode on a 7×7 board. Three pieces at a time, no rotating; only the piece you use is replaced. Clear rows and columns, chain clears for a streak.",
    "Marathon levels: every 10 lines is a new level. Levels 1–2 are calm, then big pieces start to appear, and every level makes your clears worth 10% more.",
    "Marathon high scores on T-Terminal, every one checked by replaying the game on the server.",
    "Turn Based: two players, one device, a 7×7 board, taking turns.",
    "New music: Butterfly on the menu; Initial Wave, Lullaby, Water Light and Wave Effect in game.",
  ] },
  { v: "v0.9.0", date: "NOV 2026", title: "TERMINAL, CHAT AND PROFILES", items: [
    "T-Terminal: search players, browse the rankings, open anyone's record.",
    "Chat with your opponent during online matches.",
    "Tap a player's name in a match or a replay to see their profile.",
    "New pages: About, News, Download and Help. Install Tesella as an app.",
    "A version number beside every title.",
  ] },
  { v: "v0.8", date: "NOV 2026", title: "PINS, SOUND AND MUSIC", items: [
    "Pins are a switch: turn PIN on and the piece you place lands pinned.",
    "Each turn your opponent deletes earns you one pin charge (bank up to 2).",
    "Sound effects for everything, and music for the menu and matches.",
    "Pixel sliders; volume and music settings.",
  ] },
  { v: "v0.7", date: "NOV 2026", title: "TESELLA", items: [
    "The game has a name: Tesella.",
    "Replays: every match saved, with a share code and a move list.",
    "Private rooms with codes, guests welcome; unranked play.",
    "Single player is one slider: AI strength 1 to 10.",
  ] },
  { v: "v0.6", date: "NOV 2026", title: "OVERTIME", items: [
    "Ties go to overtime: the board shrinks a ring every 20 turns.",
    "Clears beat pins, pins beat deletes, deletes beat clears.",
    "10×10 board, the seven tetrominoes, a 7-bag shared by both players.",
  ] },
];
export function News() {
  return (
    <SiteShell page="news">
      <Title text="NEWS" sub="Every update, newest first." />
      <Stack>
        {NEWS.map((n, i) => (
          <Panel key={n.v} color={i === 0 ? "var(--tb-you)" : undefined}>
            <div className="flex flex-wrap items-baseline justify-between" style={{ gap: px(3), marginBottom: px(4) }}>
              <span className="tb-t tb-b" style={{ color: "var(--tb-you)" }}>{n.v} · {n.title}</span>
              <span className="tb-t" style={{ color: "var(--tb-dim)" }}>{n.date}</span>
            </div>
            <ul className="tb-t" style={{ margin: 0, paddingLeft: px(8) }}>
              {n.items.map((it) => <li key={it} style={{ marginBottom: px(2) }}>{it}</li>)}
            </ul>
          </Panel>
        ))}
      </Stack>
      <PlayButton />
    </SiteShell>
  );
}

/* ============================================================
   DOWNLOAD — pink
   ============================================================ */
export function Download() {
  // Chrome, Edge and Android offer an install prompt we can trigger from a button.
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => window.matchMedia?.("(display-mode: standalone)").matches);
  useEffect(() => {
    const on = (e) => { e.preventDefault(); setPrompt(e); };
    const done = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", on); window.removeEventListener("appinstalled", done); };
  }, []);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <SiteShell page="download">
      <Title text="DOWNLOAD" sub="Tesella as an app: its own icon, full screen, no browser bar." />
      <Stack>
        <Panel color="var(--tb-you)">
          <H>INSTALL</H>
          {installed ? (
            <div className="tb-t">You're playing the installed app. Nothing more to do.</div>
          ) : prompt ? (
            <button className="tb-t" style={{ height: px(20), padding: `0 ${px(10)}`, color: "var(--tb-text)", ...glassFill("var(--tb-you)") }}
              onClick={async () => { prompt.prompt(); await prompt.userChoice.catch(() => null); setPrompt(null); }}>
              INSTALL TESELLA
            </button>
          ) : (
            <div className="tb-t tb-prose">
              <p>{ios ? "On iPhone and iPad, use the steps below." : "Your browser didn't offer a one-tap install here. Use the steps below for your device."}</p>
            </div>
          )}
        </Panel>
        <Panel>
          <H>IPHONE / IPAD</H>
          <div className="tb-t tb-prose"><p>Open tesella.io in Safari, tap the Share button, then ADD TO HOME SCREEN.</p></div>
        </Panel>
        <Panel>
          <H>ANDROID</H>
          <div className="tb-t tb-prose"><p>Open tesella.io in Chrome, tap the ⋮ menu, then INSTALL APP (or ADD TO HOME SCREEN).</p></div>
        </Panel>
        <Panel>
          <H>WINDOWS / MAC / LINUX</H>
          <div className="tb-t tb-prose"><p>In Chrome or Edge, click the install icon at the right of the address bar, or use the browser menu: INSTALL TESELLA.</p></div>
        </Panel>
        <Panel>
          <H>COMING LATER</H>
          <div className="tb-t tb-prose"><p>Store versions for Android and iOS, and desktop downloads. Until then the installed app is the same game, always up to date.</p></div>
        </Panel>
      </Stack>
      <PlayButton />
    </SiteShell>
  );
}

/* ============================================================
   HELP — green
   ============================================================ */
const FAQ = [
  ["HOW DO I PLAY?", "Open the game and press the book icon on the menu for a short walkthrough, or read the ABOUT page."],
  ["I DIDN'T GET MY CODE", "Codes arrive within a minute from no-reply@tesella.io. Check your spam folder, then use RESEND on the verify screen (once a minute)."],
  ["I FORGOT MY PASSWORD", "On the login screen choose FORGOT PASSWORD. We email a code; enter it with your new password."],
  ["HOW DOES RANKING WORK?", "Ranked games use a Glicko rating, shown as TR. After 10 placement games you get a rank from F up to X. Win against stronger players to climb faster."],
  ["CAN I PLAY WITHOUT AN ACCOUNT?", "Yes: single player, take turns, unranked and private rooms all work as a guest. Ranked needs an account with a verified email."],
  ["CHAT RULES", "Be respectful. No harassment, hate, threats or spam. Chat is filtered and rate-limited; you can turn your opponent's chat off from the chat panel."],
  ["IT SAYS SERVER OFFLINE", "The game reconnects by itself. If it stays offline, the server may be restarting for an update; try again in a minute."],
  ["MY MATCH ENDED SUDDENLY", "If the server restarts mid-match the game is abandoned without changing anyone's rating. If your opponent leaves and doesn't return, you win."],
];
export function Help() {
  const [open, setOpen] = useState(0);
  return (
    <SiteShell page="help">
      <Title text="HELP" sub="Answers to common questions." />
      <Stack>
        {FAQ.map(([q, a], i) => (
          <div key={q} style={glass(open === i ? "var(--tb-you)" : undefined)}>
            <button className="tb-t w-full text-left flex justify-between items-center" aria-expanded={open === i}
              onClick={() => setOpen(open === i ? -1 : i)}
              style={{ padding: px(5), color: open === i ? "var(--tb-you)" : "var(--tb-text)", background: "none", border: "none" }}>
              <span>{q}</span><span aria-hidden="true">{open === i ? "−" : "+"}</span>
            </button>
            {open === i && <div className="tb-t" style={{ padding: `0 ${px(5)} ${px(5)}` }}>{a}</div>}
          </div>
        ))}
        <Panel>
          <H>STILL STUCK?</H>
          <div className="tb-t tb-prose">
            <p>Email <a href="mailto:support@tesella.io">support@tesella.io</a> with your player name and what happened.</p>
          </div>
        </Panel>
      </Stack>
      <PlayButton />
    </SiteShell>
  );
}
