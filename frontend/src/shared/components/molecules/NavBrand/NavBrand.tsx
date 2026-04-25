import { BrandMark } from "@/shared/components/atoms";
import styles from "./NavBrand.module.css";

interface NavBrandProps {
  href?: string;
  name?: string;
  tagline?: string;
}

export const NavBrand = ({
  href = "/",
  name = "Project Hannibal",
  tagline = "// build to learn",
}: NavBrandProps) => {
  return (
    <a href={href} className={styles.brand}>
      <BrandMark />
      <div className={styles.name}>
        {name}
        <span className={styles.tagline}>{tagline}</span>
      </div>
    </a>
  );
};
