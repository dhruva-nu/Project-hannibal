export const APP_ROUTES = ["/home", "/courses", "/storyboard", "/design-board", "/arch-test"] as const;
export type AppRoute = (typeof APP_ROUTES)[number];
