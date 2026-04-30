import React from "react";
import styles from "./CourseCard.module.css";

type DifficultyLevel = "beginner" | "intermediate" | "advanced" | "next-step";

interface RegularCardProps {
  isGenUi?: false;
  code: string;
  title: string;
  description: string;
  level: DifficultyLevel;
  lessons?: number;
  duration: string;
  buildCount?: number;
  stack?: string[];
  ribbon?: string;
  pin?: string;
  illustration: React.ReactNode;
}

interface GenUiCardProps {
  isGenUi: true;
  genUiSymbol?: string;
  genUiLabel: string;
  genUiHint: string;
}

export type CourseCardProps = RegularCardProps | GenUiCardProps;

const LEVEL_CLASS: Record<DifficultyLevel, string> = {
  beginner: styles.levelBeginner,
  intermediate: styles.levelIntermediate,
  advanced: styles.levelAdvanced,
  "next-step": styles.levelNextStep,
};

const LEVEL_LABEL: Record<DifficultyLevel, string> = {
  beginner: "beginner",
  intermediate: "intermediate",
  advanced: "advanced",
  "next-step": "next step",
};

export const CourseCard = (props: CourseCardProps) => {
  if (props.isGenUi) {
    return (
      <article className={[styles.card, styles.genui].join(" ")}>
        <div>
          <div className={styles.genuiSymbol}>{props.genUiSymbol ?? "+ ✦"}</div>
          <div className={styles.genuiLabel}>{props.genUiLabel}</div>
          <div className={styles.genuiHint}>{props.genUiHint}</div>
        </div>
      </article>
    );
  }

  return (
    <article className={styles.card}>
      <span className={styles.tag}>{props.code}</span>
      {props.ribbon && <span className={styles.ribbon}>{props.ribbon}</span>}

      <div className={styles.illus}>
        {props.pin && <span className={styles.pin}>{props.pin}</span>}
        {props.illustration}
      </div>

      <div className={styles.title}>{props.title}</div>
      <div className={styles.desc}>{props.description}</div>

      <div className={styles.meta}>
        <span className={[styles.level, LEVEL_CLASS[props.level]].join(" ")}>
          {LEVEL_LABEL[props.level]}
        </span>
        {props.lessons !== undefined && (
          <>
            <span>·</span>
            <span>{props.lessons} lessons</span>
          </>
        )}
        {props.duration && (
          <>
            <span className={styles.dot} aria-hidden="true" />
            <span>{props.duration}</span>
          </>
        )}
        {props.buildCount !== undefined && (
          <>
            <span className={styles.dot} aria-hidden="true" />
            <span>{props.buildCount.toLocaleString()} builds</span>
          </>
        )}
      </div>

      <div className={styles.cta}>
        {props.stack && props.stack.length > 0 && (
          <div className={styles.stack}>
            {props.stack.map((tech) => (
              <span key={tech}>{tech}</span>
            ))}
          </div>
        )}
        <span className={styles.go}>start build →</span>
      </div>
    </article>
  );
};
