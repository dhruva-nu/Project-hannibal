import { Fragment } from "react";
import type { ArchNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { LinkButton, MutedText } from "@/shared/components/atoms";

export const ArchNodeLinks = ({ nodes }: { nodes: readonly ArchNode[] }) => {
  const api = useArch();
  if (!nodes.length) return <MutedText>none yet</MutedText>;
  return (
    <>
      {nodes.map((n, index) => (
        <Fragment key={n.id}>
          {index > 0 && ", "}
          <LinkButton
            onClick={() => {
              api.closeModal();
              api.reveal(n.id);
            }}
          >
            {n.name}
          </LinkButton>
        </Fragment>
      ))}
    </>
  );
};
