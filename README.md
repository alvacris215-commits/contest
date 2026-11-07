# Contest Manager (offline)

Open `index.html` in **Google Chrome** or **Microsoft Edge**. Double-clicking the file works. You don't need internet, a server or any installation.

## Setup (dashboard)

| Tab | What you do there |
| --- | --- |
| 👥 Contesters | Register people with an ID number, a name and a photo. To add many at once, select several photos; each file name becomes the person's name. |
| 🎟 Tickets / Problems | Create problems as an image, as text, or as image + text, with a title, text size, alignment and colours. A live preview shows how each one will look. |
| ⏱ Timers | Set the phases, such as Preparing → Presenting, plus any extra ones you add, with each phase's length and colour. |
| 🏆 Rounds | History of each round: who, with whom, and which ticket. Export it as CSV. |
| ⚙ Settings | Title, sound, reveal delay, ticket reuse, and backup export/import. |

Everything is saved automatically in the browser's IndexedDB storage. To move the contest to another computer, use **Settings → Export backup** and then **Import backup** there.

## Running the contest

Click **Start Contest**. On the stage, **any key** (or a mouse click) moves to the next step:

1. The number orb spins through the waiting contester IDs. **Press a key** to stop it. It slows down, pauses for one second, then reveals the contester's photo and name.
2. **Press a key** to start the partner draw, then **press again** to stop it. The partner is revealed, and then both people appear together.
3. **Press a key** to start the ticket draw. **Press again** and a ticket is chosen, flies to the centre and flips over to show the problem.
4. The **Preparing** timer starts after a short countdown, then the **Presenting** timer.
5. After "Round complete", **press a key** for the next round.

Keys while a timer is running: `Space` pause · `Enter`/`→` end this phase now · `↑`/`↓` ±10 s.
`Esc` opens the menu: Resume · Redo this round (puts the people and the ticket back) · End round now · Exit.
Move the mouse to show the fullscreen, sound and menu buttons.

Notes:
- People who have presented are marked as "Presented" and are not drawn again. If there is an odd number, the last person's partner is drawn from earlier presenters.
- When every ticket has been used, the deck reshuffles. You can turn this off in Settings.
- In fullscreen, the first `Esc` exits fullscreen (that is the browser's behaviour). Press it again for the menu.
