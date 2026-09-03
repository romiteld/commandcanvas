import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./command-canvas-landing.module.css";

const repositoryUrl = "https://github.com/romiteld/commandcanvas";

type IconName =
  | "arrow"
  | "check"
  | "cursor"
  | "hand"
  | "mic"
  | "people"
  | "play"
  | "receipt"
  | "spark";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "arrow":
      return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case "cursor":
      return <svg {...common}><path d="m6 4 11 8-6 1-3 6Z" /></svg>;
    case "hand":
      return (
        <svg {...common}>
          <path d="M7.5 11V6.5a1.5 1.5 0 0 1 3 0V10" />
          <path d="M10.5 9V4.5a1.5 1.5 0 0 1 3 0V10" />
          <path d="M13.5 9V6a1.5 1.5 0 0 1 3 0v5" />
          <path d="M16.5 10a1.5 1.5 0 0 1 3 0v3.5c0 4.2-2.7 7-6.6 7H11c-2 0-3.5-.8-4.6-2.4L3.8 14a1.6 1.6 0 0 1 2.5-2l1.2 1.1Z" />
        </svg>
      );
    case "mic":
      return (
        <svg {...common}>
          <rect x="8" y="3" width="8" height="13" rx="4" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c.5-4 2.5-6 6-6s5.5 2 6 6" />
          <path d="M16 5.5a3 3 0 0 1 0 5.5M17 13c2.4.5 3.7 2.4 4 5" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m10 8 6 4-6 4Z" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...common}>
          <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case "spark":
      return <svg {...common}><path d="M12 2c.5 5.2 4.1 8.7 9 9-4.9.3-8.5 3.8-9 9-.5-5.2-4.1-8.7-9-9 4.9-.3 8.5-3.8 9-9Z" /></svg>;
  }
}

function Avatar({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`${styles.avatar} ${styles[tone]}`} title={label}>
      {label.slice(0, 1)}
    </span>
  );
}

function Brand() {
  return (
    <Link href="/" className={styles.brand} aria-label="CommandCanvas home">
      <span className={styles.brandMark} aria-hidden="true">CC</span>
      <span>CommandCanvas</span>
    </Link>
  );
}

function FlowDiagram({ rough = false }: { rough?: boolean }) {
  return (
    <div className={`${styles.flowDiagram} ${rough ? styles.roughFlow : ""}`}>
      <span className={styles.flowTop}>{rough ? "Idea" : "Client"}</span>
      <i className={styles.flowStem} />
      <span className={styles.flowMiddle}>{rough ? "Logic" : "Service"}</span>
      <i className={styles.flowBranch} />
      <span className={styles.flowLeft}>API</span>
      <span className={styles.flowRight}>{rough ? "DB" : "Data"}</span>
    </div>
  );
}

function HeroWorkspace() {
  return (
    <figure className={styles.heroWorkspace}>
      <figcaption className={styles.workspaceEvidence}>
        <span>Product illustration using real hand-capture frames</span>
        <span className={styles.srOnly}>
          A CommandCanvas sprint planning room with live collaborators, goals,
          tasks, a schedule, a rough sketch becoming a structured visual, voice
          input, hand tracking, and attributed activity receipts.
        </span>
      </figcaption>
      <div aria-hidden="true">
        <div className={styles.workspaceTopbar}>
          <div className={styles.workspaceRoom}>
            <span className={styles.miniMark}>CC</span>
            <strong>Sprint planning</strong>
            <span className={styles.liveTiny}>Live</span>
          </div>
          <div className={styles.workspacePeople}>
            <div className={styles.avatarStack}>
              <Avatar label="Daniel" tone="avatarCoral" />
              <Avatar label="Mina" tone="avatarLavender" />
              <Avatar label="Alex" tone="avatarTeal" />
              <Avatar label="Sam" tone="avatarGold" />
            </div>
            <span className={styles.mockButton}>Share</span>
            <span className={styles.moreButton}>•••</span>
          </div>
        </div>

        <div className={styles.workspaceCanvas}>
          <section className={`${styles.canvasPanel} ${styles.goalsPanel}`}>
            <span className={styles.panelLabel}>Goals</span>
            <div className={styles.stickyRow}>
              <span className={styles.stickyYellow}>Improve onboarding</span>
              <span className={styles.stickyBlue}>Reduce support churn</span>
              <span className={styles.stickyPurple}>Ship agent summary</span>
            </div>
          </section>

          <section className={`${styles.canvasPanel} ${styles.timelinePanel}`}>
            <div className={styles.panelHeadingRow}>
              <span className={styles.panelLabel}>Timeline</span>
              <span className={styles.timelineDates}>12&nbsp;&nbsp;13&nbsp;&nbsp;14&nbsp;&nbsp;15</span>
            </div>
            <div className={styles.timelineRows}>
              <span>Research</span><i className={styles.timelineViolet} />
              <span>Design</span><i className={styles.timelineBlue} />
              <span>Build</span><i className={styles.timelineMint} />
              <span>QA</span><i className={styles.timelineOrange} />
              <b className={styles.todayLine} />
            </div>
          </section>

          <section className={`${styles.canvasPanel} ${styles.tasksPanel}`}>
            <span className={styles.panelLabel}>Tasks</span>
            <ul>
              <li><b className={styles.taskDone}>✓</b> User research <em>Mina</em></li>
              <li><b /> Wireframes <em>Daniel</em></li>
              <li><b /> Prototype <em>Alex</em></li>
              <li><b /> Usability test <em>Alex</em></li>
            </ul>
          </section>

          <section className={`${styles.canvasPanel} ${styles.sketchPanel}`}>
            <span className={styles.panelLabel}>Rough sketch</span>
            <FlowDiagram rough />
          </section>

          <span className={styles.transformArrow}>→</span>

          <section className={`${styles.canvasPanel} ${styles.diagramPanel}`}>
            <span className={styles.panelLabel}>Structured visual</span>
            <FlowDiagram />
          </section>

          <section className={`${styles.canvasPanel} ${styles.receiptsPanel}`}>
            <div className={styles.panelHeadingRow}>
              <span className={styles.panelLabel}>Receipts</span>
              <span className={styles.provenance}>PROVENANCE</span>
            </div>
            <ul>
              <li><Avatar label="Daniel" tone="avatarCoral" /><span><b>Daniel</b> added timeline<small>11:21 AM</small></span></li>
              <li><Avatar label="Mina" tone="avatarLavender" /><span><b>Mina</b> drew visual<small>11:22 AM</small></span></li>
              <li><span className={styles.agentAvatar}><Icon name="spark" size={13} /></span><span><b>Voice</b> created tasks<small>11:23 AM</small></span></li>
              <li><Avatar label="Alex" tone="avatarTeal" /><span><b>Alex</b> moved object<small>11:24 AM</small></span></li>
            </ul>
          </section>

          <div className={styles.voicePill}>
            <span className={styles.micOrb}><Icon name="mic" size={18} /></span>
            <span><b>Create a task for usability testing</b><small>due next Friday</small></span>
            <span className={styles.listening}><i />Listening</span>
          </div>

          <div className={styles.handSensor}>
            <Image
              src="/landing/hand-open-real.jpg"
              alt=""
              width={589}
              height={1280}
              sizes="(max-width: 600px) 24vw, 15vw"
              loading="eager"
              fetchPriority="high"
              className={styles.realHandOpen}
              data-real-hand-capture="open"
            />
            <Image
              src="/landing/hand-pinch-real.jpg"
              alt=""
              width={589}
              height={1280}
              sizes="(max-width: 600px) 12vw, 7vw"
              loading="eager"
              className={styles.realHandPinch}
              data-real-hand-capture="pinch"
            />
            <div className={styles.sensorStatus}><i /> REAL CAPTURE</div>
          </div>

          <div className={styles.canvasToolbar}>
            <span className={styles.activeTool}><Icon name="cursor" size={16} /></span>
            <span><Icon name="hand" size={16} /></span>
            <span>□</span><span>T</span><span>◇</span><span>✎</span><span>•••</span>
          </div>

          <div className={styles.remoteCursor}>
            <Icon name="cursor" size={15} /><span>Mina</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

const capabilityCards: Array<{ icon: IconName; tone: string; title: string; text: string }> = [
  { icon: "mic", tone: "violetTone", title: "Realtime voice", text: "With your OpenAI key, optional Live Voice turns spoken intent into bounded canvas actions." },
  { icon: "hand", tone: "tealTone", title: "Spatial hand control", text: "After camera calibration, local or private-relay landmarks can drive index drawing, grab, two-hand resize, minimize, and recoverable discard." },
  { icon: "receipt", tone: "orangeTone", title: "Shared receipts", text: "Supported canvas changes are attributed, visible, and reversible when technically reasonable." },
  { icon: "people", tone: "blueTone", title: "Live collaboration", text: "People join one room and edit the same spatial workspace in real time." },
  { icon: "spark", tone: "purpleTone", title: "ChatGPT Site Tools", text: "Available where supported, agents use structured page tools to create, organize, and summarize." },
];

const workflowCards: Array<{ title: string; text: string; visual: ReactNode }> = [
  {
    title: "Voice can create objects",
    text: "Start optional CommandCanvas Live Voice, speak what you need, and review the resulting canvas action.",
    visual: (
      <div className={styles.waveVisual}>
        <div className={styles.waveform}>
          {[12, 25, 40, 19, 48, 62, 31, 45, 25, 57, 38, 18, 46, 30, 13].map((height, index) => (
            <i key={`${height}-${index}`} style={{ height }} />
          ))}
        </div>
        <span className={styles.voiceSticky}>Create a research plan with milestones</span>
      </div>
    ),
  },
  {
    title: "Draw with your finger",
    text: "Use calibrated index tracking when it works well on your device, with touch, stylus, and pointer as full fallbacks.",
    visual: (
      <div className={styles.drawVisual}>
        <svg
          viewBox="0 0 260 155"
          role="img"
          aria-label="Draw with your index finger"
        >
          <title id="draw-index-title">Draw with your index finger</title>
          <desc id="draw-index-desc">
            An index finger points to the end of a dashed line beside a receipt sketch.
          </desc>
          <path className={styles.drawnLine} d="M24 38 81 22 85 74 26 80ZM85 49h58M144 22l61 6-4 58-59-8ZM175 86c-8 20-26 32-51 37" />
          <path
            className={styles.receiptArrow}
            data-part="receipt-path"
            d="M107 102c33-17 66-18 94-8"
          />
          <text x="151" y="118">Receipt</text>
          <g
            className={styles.indexPointer}
            data-gesture-finger="index"
            data-hand-orientation="unmirrored"
            data-part="index-pointer"
            transform="translate(201 94) rotate(-32) scale(3.7) translate(-6.75 0)"
          >
            <path
              className={styles.indexFingerShape}
              vectorEffect="non-scaling-stroke"
              d="M8.5 1.75a1.75 1.75 0 0 0-3.5 0v7.264l-2.112-1.66A1.69 1.69 0 0 0 .5 7.605c-.468.501-.468 1.282 0 1.783l3.884 4.414A3.5 3.5 0 0 0 6.937 15h4.626a3.5 3.5 0 0 0 3.5-3.5V7.405a1.69 1.69 0 0 0-1.694-1.689 1.7 1.7 0 0 0-.99.321 1.69 1.69 0 0 0-1.694-1.28c-.37 0-.713.12-.99.322a1.69 1.69 0 0 0-1.195-.523z"
            />
          </g>
          <circle className={styles.indexTipHalo} cx="201" cy="94" r="8" />
          <circle
            className={styles.indexTipDot}
            cx="201"
            cy="94"
            r="2.7"
            data-index-tip="true"
          />
          <text className={styles.indexTipLabel} x="207" y="87">INDEX</text>
        </svg>
      </div>
    ),
  },
  {
    title: "Collaborators join one room",
    text: "Participants see shared updates and cursors in real time while connected.",
    visual: (
      <div className={styles.peopleVisual}>
        <div className={`${styles.videoTile} ${styles.videoLilac}`}><Avatar label="Mina" tone="avatarLavender" /><span>Mina</span></div>
        <div className={`${styles.videoTile} ${styles.videoBlue}`}><Avatar label="Daniel" tone="avatarCoral" /><span>Daniel</span></div>
        <div className={`${styles.videoTile} ${styles.videoMint}`}><Avatar label="Alex" tone="avatarTeal" /><span>Alex</span></div>
        <span className={styles.cursorTag}><Icon name="cursor" size={14} /> Sam</span>
      </div>
    ),
  },
  {
    title: "Agents act through tools",
    text: "Agents use page tools to gather context, draft content, and keep work moving.",
    visual: (
      <div className={styles.agentVisual}>
        <div className={styles.agentWorking}><Icon name="spark" size={16} /> Agent is working</div>
        <span><i><Icon name="check" size={12} /></i> Read selected objects</span>
        <span><i><Icon name="check" size={12} /></i> Organize meeting notes</span>
        <span><i><Icon name="check" size={12} /></i> Create action items</span>
      </div>
    ),
  },
];

function CapabilityStrip() {
  return (
    <ul className={styles.capabilityStrip} aria-label="CommandCanvas capabilities">
      {capabilityCards.map((card) => (
        <li className={styles.capabilityCard} key={card.title}>
          <span className={`${styles.capabilityIcon} ${styles[card.tone]}`}><Icon name={card.icon} size={24} /></span>
          <span><strong>{card.title}</strong><small>{card.text}</small></span>
        </li>
      ))}
    </ul>
  );
}

function TransformationStory() {
  return (
    <section className={styles.proofSection} aria-label="Structured transformation and receipts">
      <div className={styles.transformStory}>
        <h2 aria-label="From rough sketch to structured output">From rough sketch<br />to structured output</h2>
        <div className={styles.transformBoard} aria-label="A rough sketch becomes a structured visual">
          <div><span className={styles.proofLabel}>Rough sketch</span><FlowDiagram rough /></div>
          <span className={styles.proofArrow} aria-hidden="true"><Icon name="arrow" size={25} /></span>
          <div><span className={styles.proofLabel}>One structured example</span><FlowDiagram /></div>
        </div>
        <p>CommandCanvas preserves the original thought, then creates a clean semantic object beside it for review and reuse.</p>
      </div>

      <div className={styles.receiptStory}>
        <h2>Supported changes leave receipts</h2>
        <div className={styles.receiptProof}>
          <div className={styles.receiptTable} role="table" aria-label="Recent workspace activity">
            <div className={styles.receiptTableHead} role="row">
              <span role="columnheader">Time</span><span role="columnheader">Actor</span><span role="columnheader">Action</span><span role="columnheader">Object</span>
            </div>
            {[
              ["11:21", "Daniel", "Added timeline", "Timeline"],
              ["11:22", "Mina", "Drew visual", "Diagram"],
              ["11:23", "Voice", "Created tasks", "Tasks"],
              ["11:24", "Alex", "Moved object", "Sticky note"],
              ["11:25", "Agent", "Summarized page", "Summary"],
            ].map((row) => (
              <div className={styles.receiptTableRow} role="row" key={row.join("-")}>
                {row.map((cell) => <span role="cell" key={cell}>{cell}</span>)}
              </div>
            ))}
          </div>
          <div className={styles.receiptDetail}>
            <span className={styles.proofLabel}>Receipt details</span>
            <dl>
              <div><dt>Actor</dt><dd>Daniel</dd></div>
              <div><dt>Action</dt><dd>Added timeline</dd></div>
              <div><dt>Object</dt><dd>Timeline</dd></div>
              <div><dt>Method</dt><dd>Pointer</dd></div>
              <div><dt>Session</dt><dd>Sprint planning</dd></div>
            </dl>
            <span className={styles.recordedBadge}><Icon name="check" size={12} /> Recorded</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CommandCanvasLanding() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>

      <header className={styles.header}>
        <nav className={styles.nav} aria-label="Primary navigation">
          <Brand />
          <div className={styles.navLinks}>
            <a href="#product">Product</a>
            <a href="#how-it-works">How it works</a>
            <Link href="/demo">Judge preview</Link>
            <a href={`${repositoryUrl}#readme`} target="_blank" rel="noreferrer noopener">Docs</a>
          </div>
          <Link
            aria-label="Try the no-signup demo"
            className={styles.navCta}
            href="/demo"
          >
            <span className={styles.navCtaFull}>Try the demo</span>
            <span className={styles.navCtaCompact} aria-hidden="true">Try</span>
            <Icon name="arrow" size={15} />
          </Link>
        </nav>
      </header>

      <main id="main-content">
        <section className={styles.hero} id="product">
          <div className={styles.heroCopy}>
            <span className={styles.liveBadge}><i /> Live collaborative workspace</span>
            <h1 aria-label="Where meetings become the deliverable">Where meetings{" "}<br />become the{" "}<br />deliverable</h1>
            <p>
              Teams use voice, hand input, collaborators, and agents to create notes,
              boards, schedules, sketches, diagrams, charts, and meeting packets
              together, live and on one infinite canvas.
            </p>
            <div className={styles.heroActions}>
              <Link aria-label="Try the no-signup demo" className={styles.primaryCta} href="/demo">Try the demo <Icon name="arrow" size={17} /></Link>
              <Link className={styles.secondaryCta} href="/meet"><Icon name="people" size={18} /> Start a signed-in room</Link>
            </div>
            <div className={styles.heroAudience}>
              <div className={styles.avatarStack} aria-hidden="true">
                <Avatar label="D" tone="avatarCoral" /><Avatar label="M" tone="avatarLavender" /><Avatar label="A" tone="avatarTeal" /><Avatar label="S" tone="avatarGold" />
              </div>
              <span>For product, engineering, design, and operations teams</span>
            </div>
          </div>
          <HeroWorkspace />
        </section>

        <CapabilityStrip />

        <section className={styles.workflowSection} id="how-it-works">
          <div className={styles.sectionHeading}>
            <span className={styles.sectionEyebrow}>ONE SHARED SURFACE</span>
            <h2>Everything happens on one living canvas</h2>
          </div>
          <div className={styles.workflowGrid}>
            {workflowCards.map((card, index) => (
              <article className={styles.workflowCard} key={card.title}>
                <div className={styles.workflowVisual} aria-hidden="true">{card.visual}</div>
                <div className={styles.workflowCopy}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <div><h3>{card.title}</h3><p>{card.text}</p></div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <TransformationStory />

        <section className={styles.finalCta}>
          <div>
            <span>ENTER THE WORKSPACE</span>
            <h2>Step into the canvas</h2>
            <p>See how your team can think, plan, and build together with voice, hands, people, and agents.</p>
          </div>
          <div className={styles.finalActions}>
            <Link className={styles.finalPrimary} href="/demo"><Icon name="spark" size={18} /> Launch demo</Link>
            <a className={styles.finalSecondary} href={repositoryUrl} target="_blank" rel="noreferrer noopener">View repository <Icon name="arrow" size={16} /></a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <Brand />
        <p>A spatial meeting workspace for people and agents.</p>
        <div>
          <a href={`${repositoryUrl}#readme`} target="_blank" rel="noreferrer noopener">Read the docs</a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer noopener">Source</a>
        </div>
      </footer>
    </div>
  );
}
