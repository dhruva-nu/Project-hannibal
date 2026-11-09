import {
  APP_STEP_KINDS,
  STEP_KIND_OPTIONS,
  newAppService,
  newAppStep,
  type AppService,
  type ServiceNode,
} from "@/pages/ArchTest/engine";
import { HintText, ToolButton } from "@/shared/components/atoms";
import { FormRow, PanelSection } from "@/shared/components/molecules";
import { BoundSelect, BoundText } from "../Bound";
import { scopeEditor, type Editor } from "../panelEditor";
import { AddRowButton, RowList } from "../rows";
import styles from "./popup.module.css";

const AppServiceCard = ({ service, index, editor }: { service: AppService; index: number; editor: Editor }) => {
  const scoped = scopeEditor(editor, service.id, (target: ServiceNode) => {
    const found = target.cfg.appServices.find((a) => a.id === service.id);
    if (!found) throw new Error(`In-app service "${service.id}" no longer exists`);
    return found;
  });
  return (
    <div className={styles.libraryCard}>
      <FormRow>
        <BoundText editor={scoped} path="name" value={service.name} aria-label="In-app service name" />
        <AddRowButton label="Add step" editor={scoped} path="steps" item={newAppStep()} />
        <ToolButton small keepWidth onClick={() => editor.remove("cfg.appServices", index)} aria-label={`Delete ${service.name}`}>
          ✕
        </ToolButton>
      </FormRow>
      <RowList
        items={service.steps}
        path="steps"
        editor={scoped}
        emptyNote="No steps yet. Add what this function does."
        renderRow={(step, _i, rowPath, removeButton) => (
          <FormRow>
            <BoundSelect editor={scoped} path={`${rowPath}.kind`} value={step.kind} options={STEP_KIND_OPTIONS} aria-label="Step kind" />
            <BoundText
              editor={scoped}
              path={`${rowPath}.target`}
              value={step.target}
              monospace
              placeholder={APP_STEP_KINDS[step.kind].targetPlaceholder}
              aria-label={APP_STEP_KINDS[step.kind].targetLabel}
            />
            <BoundText editor={scoped} path={`${rowPath}.detail`} value={step.detail} placeholder="notes (optional)" aria-label="Step notes" />
            {removeButton}
          </FormRow>
        )}
      />
    </div>
  );
};

export const AppServiceLibrary = ({ node, editor }: { node: ServiceNode; editor: Editor }) => (
  <PanelSection
    title="In-app services"
    action={
      <ToolButton small onClick={() => editor.push("cfg.appServices", newAppService(`appService${node.cfg.appServices.length + 1}`))}>
        New in-app service
      </ToolButton>
    }
  >
    {!node.cfg.appServices.length && (
      <HintText>Reusable functions this service can call, such as fetch from S3 then cache in Redis.</HintText>
    )}
    {node.cfg.appServices.map((service, index) => (
      <AppServiceCard key={service.id} service={service} index={index} editor={editor} />
    ))}
  </PanelSection>
);
