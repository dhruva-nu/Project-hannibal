import { Fragment } from "react";
import type { ArchNode } from "../engine";
import { useArch } from "../state/archApi";
import { LinkButton, Muted } from "./Controls";

export const NodeLinks = ({ nodes }: { nodes: readonly ArchNode[] }) => {
  const api = useArch();
  if (!nodes.length) return <Muted>none yet</Muted>;
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
