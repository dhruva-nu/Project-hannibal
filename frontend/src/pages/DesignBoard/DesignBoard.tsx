import { useEffect, useState } from "react";
import { BrandMark } from "@/shared/components/atoms/BrandMark/BrandMark";
import { Button } from "@/shared/components/atoms/Button/Button";
import { ThemeToggle } from "@/shared/components/atoms/ThemeToggle/ThemeToggle";
import { PaperBg } from "@/shared/components/atoms/PaperBg/PaperBg";
import { DesignPalette } from "@/shared/components/organisms/DesignPalette/DesignPalette";
import { DesignCanvas } from "@/shared/components/organisms/DesignCanvas/DesignCanvas";
import { DesignInspector } from "@/shared/components/organisms/DesignInspector/DesignInspector";
import { useTheme } from "@/hooks/useTheme";
import { useDesignBoard } from "./useDesignBoard";
import type { PaletteEntry, PaletteKind, PaletteSection } from "./boardTypes";
import styles from "./DesignBoard.module.css";

const BASE_SECTIONS: PaletteSection[] = [
  {
    title: "Components",
    addKind: "component",
    items: [
      { kind: "component", label: "DB" },
      { kind: "component", label: "Redis" },
      { kind: "component", label: "Client" },
      { kind: "component", label: "OAuth Provider" },
      { kind: "component", label: "Queue" },
    ],
  },
  {
    title: "Services",
    addKind: "service",
    items: [{ kind: "service", label: "BE" }],
    tip: "drag onto the board ↘\nup to 5 modules per service",
  },
  {
    title: "Modules",
    addKind: "module",
    items: [
      { kind: "module", label: "Auth Module" },
      { kind: "module", label: "Gateway" },
      { kind: "module", label: "Worker" },
    ],
    tip: "drop modules INSIDE a service",
  },
];

export const DesignBoard = () => {
  const { theme, toggleTheme } = useTheme();
  const board = useDesignBoard();
  const [customItems, setCustomItems] = useState<PaletteEntry[]>([]);

  useEffect(() => {
    board.seed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClear = () => {
    if (window.confirm("Clear the board?")) board.clearBoard();
  };

  const handleAddCustom = (label: string, kind: PaletteKind) => {
    setCustomItems(prev => [...prev, { label, kind }]);
  };

  const sections: PaletteSection[] = BASE_SECTIONS.map(s => ({
    ...s,
    items: [...s.items, ...customItems.filter(ci => ci.kind === s.addKind)],
  }));

  return (
    <div className={styles.stage} data-theme={theme}>
      <PaperBg />

      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <a className={styles.brand} href="/home" aria-label="Home">
            <BrandMark />
          </a>
          <span className={styles.crumb}>
            /courses/<b>system-design</b>/<b>drawing-board</b>
          </span>
        </div>
        <div className={styles.topRight}>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <Button variant="ghost" onClick={handleClear}>clear</Button>
          <Button variant="ghost" onClick={board.exportJson}>export json</Button>
          <Button variant="primary">save build →</Button>
        </div>
      </header>

      <div className={styles.main}>
        <DesignPalette sections={sections} onAddCustom={handleAddCustom} />

        <DesignCanvas
          nodes={board.nodes}
          edges={board.edges}
          pending={board.pending}
          selected={board.selected}
          innerRef={board.innerRef}
          onNodeMove={board.moveNode}
          onNodeSelect={board.setSelected}
          onEdgeSelect={edgeId => board.setSelected({ kind: "edge", id: edgeId })}
          onCanvasClick={() => board.setSelected(null)}
          onPortPointerDown={board.startEdge}
          onPortPointerUp={board.finishEdge}
          onDrop={board.handleDrop}
          onAddModule={board.addModule}
        />

        <DesignInspector
          nodes={board.nodes}
          edges={board.edges}
          selected={board.selected}
          onUpdateLabel={board.updateLabel}
          onDeleteNode={board.deleteNode}
          onDeleteModule={board.deleteModule}
          onDeleteEdge={board.deleteEdge}
        />
      </div>
    </div>
  );
};
