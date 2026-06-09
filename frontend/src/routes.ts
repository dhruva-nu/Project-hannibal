export const APP_ROUTES = ["/home", "/courses", "/storyboard", "/design-board"] as const;
export type AppRoute = (typeof APP_ROUTES)[number];
