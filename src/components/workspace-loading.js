export default function WorkspaceLoading({ message = "Loading attendance data..." }) {
  return (
    <div className="page-content workspace-loading" role="status" aria-label={message}>
      <span className="loading-status">{message}</span>
      <div className="loading-heading" aria-hidden="true">
        <span className="loading-shape loading-heading-kicker" />
        <span className="loading-shape loading-heading-title" />
        <span className="loading-shape loading-heading-description" />
      </div>
      <div className="loading-metrics" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <span className="loading-shape loading-metric" key={index} />)}
      </div>
      <div className="loading-panel" aria-hidden="true">
        <span className="loading-shape loading-panel-title" />
        {Array.from({ length: 5 }, (_, index) => <span className="loading-shape loading-row" key={index} />)}
      </div>
    </div>
  );
}