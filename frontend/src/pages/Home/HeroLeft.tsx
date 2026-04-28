import { Badge, Button, StickyNote } from "@/shared/components/atoms";
import { HowItWorksStrip } from "@/shared/components/organisms";
import styles from "./Home.module.css";

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export const HeroLeft = () => (
  <div className={styles.heroLeft}>
    <StickyNote rotate={4} className={styles.stickyNote}>
      don&apos;t just<br />watch — <u>build it</u> ✦
    </StickyNote>

    <Badge label="Hands-on coding · System design" />

    <h1 className={styles.headline}>
      Stop watching tutorials.<br />
      <span className={styles.marker}>Build the system</span><br />
      <span className={styles.scribble}>— then understand it.</span>
    </h1>

    <p className={styles.sub}>
      Project Hannibal is a hands-on platform for learning to code and design real
      systems. Our GenUI tutor draws diagrams, drops nodes on a canvas, and codes
      alongside you — so every concept ends in a working artifact, not a finished video.
    </p>

    <div className={styles.ctaRow}>
      <Button variant="primary" href="#" icon={<ArrowRightIcon />} iconPosition="right">
        Start your first build
      </Button>
      <Button variant="ghost" href="#" icon={<PlayIcon />} iconPosition="left">
        Watch a 90-sec demo
      </Button>
    </div>

    <div className={styles.metaRow}>
      <span><strong>200+</strong> guided builds</span>
      <span className={styles.metaSep} aria-hidden="true" />
      <span><strong>0</strong> setup. runs in browser</span>
      <span className={styles.metaSep} aria-hidden="true" />
      <span>free tier · no card</span>
    </div>

    <HowItWorksStrip />
  </div>
);
