import { useCopilotReadable } from "@copilotkit/react-core";
import { useAuth } from "@/context/AuthContext";
import { PaperBg } from "@/shared/components/atoms";
import { Navbar } from "@/shared/components/organisms";
import { useTheme } from "@/hooks/useTheme";
import { useAiStream } from "./useAiStream";
import { HeroLeft } from "./HeroLeft";
import { HeroRight } from "./HeroRight";
import styles from "./Home.module.css";

export const Home = () => {
  const { logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useCopilotReadable({
    description: "Current page: Project Hannibal home — hands-on system design and coding platform",
    value: { page: "home", topic: "system design, coding, and building real projects" },
  });

  useCopilotReadable({
    description: "The currently logged-in user",
    value: user ? { id: user.id, email: user.email, provider: user.provider } : null,
  });

  const { visibleMessages, isTyping, isStreaming, handleChatSubmit } = useAiStream();

  return (
    <>
      <PaperBg />
      <div className={styles.stage}>
        <Navbar theme={theme} onThemeToggle={toggleTheme} onLogout={logout} />

        <section className={styles.hero} aria-label="Hero">
          <HeroLeft />
          <HeroRight
            visibleMessages={visibleMessages}
            isTyping={isTyping}
            isStreaming={isStreaming}
            onChatSubmit={handleChatSubmit}
          />
        </section>
      </div>
    </>
  );
};
