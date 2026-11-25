import React from 'react';

interface MainWorkspaceProps {
  leftPane: React.ReactNode;
  centerPane: React.ReactNode;
  rightPane: React.ReactNode;
}

export const MainWorkspace: React.FC<MainWorkspaceProps> = ({
  leftPane,
  centerPane,
  rightPane,
}) => {
  return (
    <main className="workspace-grid">
      <aside className="pane pane-left">{leftPane}</aside>
      <section className="pane pane-center">{centerPane}</section>
      <aside className="pane pane-right">{rightPane}</aside>
    </main>
  );
};
