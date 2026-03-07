import React, { ReactNode } from 'react';
import styles from './CollapsibleSection.module.css';

interface CollapsibleSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  isExpanded,
  onToggle,
  children,
}) => {
  return (
    <div className={styles.section}>
      <h2 
        className={styles.sectionTitle} 
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
      >
        {title}
      </h2>
      {isExpanded && (
        <div className={styles.sectionContent}>
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;
