import { useCopilotAction } from "@copilotkit/react-core";
import { useNavigate } from "react-router-dom";

const ROUTES = ["/home", "/courses", "/storyboard", "/design-board"] as const;

const showToolCalls = (): boolean => {
  const flag = import.meta.env.VITE_SHOW_TOOL_CALLS;
  if (flag !== undefined) return String(flag).toLowerCase() === "true";
  return import.meta.env.DEV;
};

export const useCopilotNav = () => {
  const navigate = useNavigate();

  useCopilotAction({
    name: "navigate_to",
    description:
      "Navigate the user to a route in the app. Use this when the user asks to go to a page.",
    parameters: [
      {
        name: "route",
        type: "string",
        description: `One of: ${ROUTES.join(", ")}`,
        required: true,
      },
    ],
    handler: ({ route }: { route: string }) => {
      if (!ROUTES.includes(route as (typeof ROUTES)[number])) {
        return `Unknown route: ${route}. Allowed: ${ROUTES.join(", ")}`;
      }
      navigate(route);
      return `Navigated to ${route}.`;
    },
    render: showToolCalls() ? undefined : "",
  });
};
