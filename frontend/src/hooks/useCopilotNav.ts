import { useCopilotAction } from "@copilotkit/react-core";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES, type AppRoute } from "@/routes";

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
        description: `One of: ${APP_ROUTES.join(", ")}`,
        required: true,
      },
    ],
    handler: ({ route }: { route: string }) => {
      if (!APP_ROUTES.includes(route as AppRoute)) {
        return `Unknown route: ${route}. Allowed: ${APP_ROUTES.join(", ")}`;
      }
      navigate(route);
      return `Navigated to ${route}.`;
    },
    render: showToolCalls() ? undefined : "",
  });
};
