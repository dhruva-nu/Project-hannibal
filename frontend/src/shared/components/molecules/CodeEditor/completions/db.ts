import { snippet } from "@codemirror/autocomplete";

export default {
  trigger: "db",
  methods: [
    {
      label: "store()",
      type: "method" as const,
      detail: "(key: string, value: any)",
      info: "Persist a value by key",
      apply: snippet("store(${key}, ${value})"),
    },
    {
      label: "get()",
      type: "method" as const,
      detail: "(key: string)",
      info: "Retrieve a value by key",
      apply: snippet("get(${key})"),
    },
  ],
};
