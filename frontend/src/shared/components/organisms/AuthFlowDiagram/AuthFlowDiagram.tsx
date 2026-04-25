import { BoardChrome } from "@/shared/components/molecules";
import styles from "./AuthFlowDiagram.module.css";

/**
 * Static auth-flow swimlane diagram shown on the Login page.
 * Hardcoded per the design — extend via props if the flow becomes dynamic.
 */
export const AuthFlowDiagram = () => {
  return (
    <div className={styles.board}>
      <BoardChrome
        tabs={[
          { label: "auth-flow.canvas", active: true },
          { label: "jwt.ts" },
        ]}
        metaLabel="tutor · explaining"
      />

      <div className={styles.flow}>
        <div className={styles.flowTag}>login sequence · sketched live</div>

        <div className={styles.swimlanes}>
          {/* Headers */}
          <div className={styles.laneHead}>
            You
            <span className={styles.laneHeadIcon}>✦ browser</span>
          </div>
          <div className={[styles.laneHead, styles.laneHeadCenter].join(" ")}>
            Hannibal
            <span className={[styles.laneHeadIcon, styles.laneHeadCenterIcon].join(" ")}>✦ api</span>
          </div>
          <div className={styles.laneHead}>
            Vault
            <span className={styles.laneHeadIcon}>◆ argon2</span>
          </div>

          {/* Step 1 */}
          <div className={styles.laneLabel}>
            <span className={styles.laneLabelNum}>01</span> submit
          </div>
          <div className={[styles.laneArrow, styles.outgoing].join(" ")}>
            <div className={[styles.pkt, styles.pktAccent].join(" ")}>POST /login · email + pw</div>
            <div className={styles.line} />
          </div>
          <div className={styles.laneSide}>→</div>

          {/* Step 2 */}
          <div className={styles.laneSide}>&nbsp;</div>
          <div className={[styles.laneArrow, styles.outgoing].join(" ")}>
            <div className={styles.line} />
            <div className={[styles.pkt, styles.pktCoral].join(" ")}>verify(hash, salt)</div>
          </div>
          <div className={styles.laneLabel} style={{ textAlign: "left", paddingLeft: "var(--sp-6)" }}>
            argon2id<br />~120ms
          </div>

          {/* Step 3 */}
          <div className={styles.laneSide}>&nbsp;</div>
          <div className={[styles.laneArrow, styles.incoming].join(" ")}>
            <div className={[styles.pkt, styles.pktGreen].join(" ")}>✓ ok · uid: u_4f2a</div>
            <div className={styles.line} />
          </div>
          <div className={styles.laneSide}>←</div>

          {/* Step 4 */}
          <div className={styles.laneLabel}>
            <span className={styles.laneLabelNum}>04</span> set cookie
          </div>
          <div className={[styles.laneArrow, styles.incoming].join(" ")}>
            <div className={[styles.pkt, styles.pktAccent].join(" ")}>httpOnly · session jwt</div>
            <div className={styles.line} />
          </div>
          <div className={styles.laneSide}>&nbsp;</div>
        </div>
      </div>

      <div className={styles.codeCard}>
        <span className={styles.codeTag}>tutor.snippet</span>
        <span className={styles.codeLine}>
          <span className={styles.ln}>1</span>
          <span className={styles.cm}>{"// what we'd never do — store the password directly"}</span>
        </span>
        <span className={styles.codeLine}>
          <span className={styles.ln}>2</span>
          <span className={styles.kw}>const</span>{" "}
          <span className={styles.fn}>verify</span>{" = "}
          <span className={styles.kw}>async</span>
          {" (email, pw) => {"}
        </span>
        <span className={styles.codeLine}>
          <span className={styles.ln}>3</span>
          {"  "}
          <span className={styles.kw}>const</span>
          {" u = "}
          <span className={styles.kw}>await</span>
          {" db.users."}
          <span className={styles.fn}>findOne</span>
          {"({ email });"}
        </span>
        <span className={styles.codeLine}>
          <span className={styles.ln}>4</span>
          {"  "}
          <span className={styles.kw}>return</span>
          {" argon2."}
          <span className={styles.fn}>verify</span>
          {"(u.hash, pw); "}
          <span className={styles.cm}>{"// constant-time"}</span>
        </span>
        <span className={styles.codeLine}>
          <span className={styles.ln}>5</span>
          {"}"}<span className={styles.cursor} />
        </span>
      </div>
    </div>
  );
};
