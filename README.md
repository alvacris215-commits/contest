# Contest Manager (offline)

Open `index.html` in **Google Chrome** or **Microsoft Edge**. Double-clicking the file works. You don't need internet, a server or any installation.

## Setup (dashboard)

| Tab | What you do there |
| --- | --- |
| 🗂 Structure | The contest title and its stages (see below). |
| 👥 Contesters | Register people with an ID number, a name and a photo. To add many at once, select several photos; each file name becomes the person's name. "Status in" shows who has presented in each stage. |
| 🎟 Tickets / Problems | Create problems as an image, as text, or as image + text. Tick the stages that can draw each ticket: in the form, or with the numbered buttons on each ticket card. Above the list, pick a stage and use **Tick all for this stage** / **Untick all**. "Used" is tracked per stage, so a ticket used in stage 1 can still be drawn in stage 2. Add **adjectives** to a ticket (separated by commas or new lines) and they appear under the picture on stage as soon as the round's timer starts. |
| 🧩 Format | How a round with draws works: people per round, tickets, timers. Save formats as templates (see below). |
| 🏆 Rounds | History of each round: stage, people and tickets. Export it as CSV. |
| 👑 Winners | The awards for the ceremony: personal or group, who won each one, and everyone's overall scores. |
| ⚙ Settings | Sound, fullscreen, the pause before a reveal, and backup export/import. |

Everything is saved automatically in the browser's IndexedDB storage. To move the contest to another computer, use **Settings → Export backup** and then **Import backup** there. The backup includes the structure, formats and templates.

## Contest structure

In **🗂 Structure** you set the contest title (for example *2026 Year's 2nd English Contest*) and add as many stages as you need. For each stage you write:

- an icon, a name and a one-line tagline;
- **How this stage runs**: a format or template from the Format tab (draws and timers, such as *Image description (pairs)*), or **Explanation only** for a stage that the app only explains;
- the explanation and key points the audience sees;
- presenter notes, which only you see in the console;
- an optional picture.

The opening, one click at a time: **contest title → contest structure** (each click reveals the next stage card) **→ one slide per stage → "Let's begin!"**. The next click starts stage 1.

Who has presented is tracked separately for each stage, so everyone can take part again in the next stage.

## Contest format and templates

In the **🧩 Format** tab you set:

- **Contest:** the format name, the title and subtitle on the opening screen, the round label, the title at the end of a round, and whether the step bar is shown at the top of the stage.
- **People per round:** how many contesters present together (1–6). Each person gets a draw step with a **role** (e.g. Contester, Partner, Captain) and a **title** shown while the numbers spin. You also choose whether a team is filled up with people who already presented when too few are waiting.
- **Tickets:** how many tickets are drawn per round (0–10), what they are called (Ticket, Topic, Question…), the title of the draw, and whether each ticket can be used only once. With several tickets you choose between:
  - *Draw them all, then run the timers once.*
  - *Draw one, run the timers, then draw the next.* This suits quizzes.
- **Timer phases:** any number of phases (e.g. Preparing → Presenting → Questions), with each phase's length and colour, plus the countdown and warning colours.

Titles can use `{round}`, `{name}` (first person drawn), `{last}` (latest person drawn), `{team}` (everyone drawn so far), `{n}` and `{total}` (ticket number and tickets per round).

The **Templates** list has four built-in formats: Image description (pairs), Solo speech, Team of three, and Quiz duel. Click **Use this format** to load one, change anything you like, then **Save the current format as a template** to keep it. A template card shows **In use** and **changed** when you edit the format after loading it; **💾 Save changes** updates your own template.

### The opening title

The contest title is drawn as 3D gold lettering on the opening screen. Sparks swirl in and gather into the letters, a beam of light turns them into gold, and then a shine sweeps across them every few seconds. Long titles are split over two balanced lines; put `|` in the title to choose the break yourself (for example `2026 Year's 2nd | English Contest`). Ordinals such as 2nd are written with a raised "ND". Pressing a key while the title is still appearing shows it at once; the next key starts the first draw.

## Running the contest

Click **Start Contest** and choose:

### Two screens (recommended)

Connect the projector or TV as a second screen (extended display, not mirrored). This window becomes the **presenter console**, and the audience screen opens in a second window. Chrome may ask to "manage windows on all your displays": allow it, and the audience window opens on the second screen by itself. Otherwise, drag it there. **Click once on the audience window** to make it fullscreen. Sound plays from this window.

In the console:
- **Next** (or any key, or a presenter clicker) moves the audience screen on: the title, each stage reveal, each slide, then every draw. Contesters can press any key on this keyboard to stop a draw.
- The **Opening** list jumps to any slide; the **Stages** list starts any stage.
- While a timer runs you see it here, with pause, ±10 s and end-phase buttons.
- **Notes** shows your presenter notes for what is on screen. **Contesters** shows who is waiting in the current stage.
- Redo this round, End this round and End this stage are at the bottom. **Show the waiting screen** puts the audience screen back to the title card.

### Scoring

Set the judges' names in **🗂 Structure → Judges** (three by default) and scoring options in **🧩 Format → Scoring** (on/off, highest score, decimals).

After a round's timers, the audience screen shows the first person's photo and name with a hidden card for each judge. In the console, type each judge's score (Enter moves to the next box) and click **Show the score**. On the audience screen the judges' cards flip one by one, then the average appears straight away. Press **Next** for the partner, who is scored the same way. After the last person, the next key press starts the next round's draw, so the partner stops the spinner for the next first contester.

When everyone in a stage has presented (or you click **End this stage**), the audience sees the **ranking**: places 4 and below appear from the bottom up, then the podium for 3rd, 2nd and 1st. The next key shows the "stage complete" screen.

Scores are saved with each round. The **🏆 Rounds** tab shows them, ranks everyone per stage, and includes every judge's score in the CSV export. Delete one round with its 🗑 button: its scores leave the rankings, and you can choose to mark its people as waiting again so they present again. In one-screen mode, press a key on the waiting screen to open a small score form.

### Qualifying and random groups

Each stage in **🗂 Structure** has a **Who takes part** setting:

- **Everyone** (the default).
- **Top scorers only:** choose how many go through, whether they are ranked by the **average** or the **total** of the stage scores, and which earlier stages count (none ticked means all earlier stages). A person's score in a stage is their judges' average in that stage; a counted stage they have no score in counts as 0. With **Everyone tied at the cut-off also goes through**, a tie at the last place lets everyone tied in.

The card shows who qualifies right now and the cut-off score. In **👥 Contesters**, pick that stage to see who did not qualify.

Tick **Draw random groups at the start of this stage** to put the stage's people into groups: either groups of N people or N groups (the sizes differ by one at most).

**Who goes through is announced at the end of the stage before.** For example, when stage 2 ends: its ranking, then **Qualified for the Final**. The qualifiers' cards appear from the last place up to the first, with their score in each counted stage and their average (or total). Then the "stage complete" screen.

When the stage itself starts, after its title:

1. If the qualifiers were not announced yet (for example when you start the Final directly), they are shown first.
2. **Group draw:** each click spins over the remaining people, stops on one, and flies them into the next group (Group A, B, C… in turn). **Draw all the rest** in the console finishes it quickly.
3. **The rounds go group by group:** each round's team is the next group, then tickets, timers and scores as the stage's format says.

The groups are saved. In the console, each stage has **Show who qualified** and **Draw the groups (again)**; the Structure card has **Clear the groups**.

### Winners ceremony

In **👑 Winners**, add the awards:

- **Personal award:** pick the winner.
- **Group award:** add the members, or use a team from a round, and optionally give the group a name.
- Each award has a title, a medal (gold, silver, bronze or special) and an optional line shown under the name.
- **Fill 1st–3rd from the scores** creates the top three from the overall averages. The overall average is the mean of a person's stage averages; the table at the bottom shows everyone's.

Click **Show the winners**. The console and the audience screen open (or are reused), and the ceremony starts:

1. The title "The Winners" is drawn in gold.
2. For each award, the first click shows the award with a hidden winner. The next click plays a drumroll, flips the photo, and shows the winner with fireworks, then their scores slide in: for a person, each stage's judge scores and stage score; for a group, each member's score in every stage.
3. After the last award, all the winners appear together. Each click there sets off more fireworks.

By default, awards are revealed from the bottom of the list up, so the award at the top comes last. The console's **Winners** list jumps to any award. **Show on this screen** runs the ceremony on the dashboard's screen instead.

### One screen

The contest fills this screen and you click or press keys on it. Choose whether to start with the opening or a stage.

Keys while a timer is running: `Space` pause · `Enter`/`→` end this phase now · `↑`/`↓` ±10 s.
`Esc` opens the menu: Resume · Redo this round (puts the people and tickets back) · End round now · Exit.
Move the mouse to show the fullscreen, sound and menu buttons.

Notes:
- People who have presented are marked as "Presented" and are not drawn again.
- When every ticket has been used, the deck reshuffles. Turn off "Each ticket can be drawn only once" in the format to always use the full deck.
- In fullscreen, the first `Esc` exits fullscreen (that is the browser's behaviour). Press it again for the menu.
