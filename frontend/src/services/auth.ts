import { api } from "./api";
import type { User } from "@/shared/types";

export function getCurrentUser(): Promise<User> {
  return api.get<User>("/api/v1/auth/me");
}

export function login(email: string, password: string): Promise<User> {
  return api.post<User>("/api/v1/auth/login", { email, password });
}

export function register(email: string, password: string): Promise<void> {
  return api.post<void>("/api/v1/auth/register", { email, password });
}

export function logout(): Promise<void> {
  return api.post<void>("/api/v1/auth/logout");
}
