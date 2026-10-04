"use client";

import { useActionState } from "react";
import { saveSchoolLocation } from "@/app/actions/school-locations";
import FormFeedback from "@/components/auth/form-feedback";

const initialState = { status: "idle", message: "" };

function LocationCoveragePreview({ location }) {
  return (
    <div className="location-coverage-preview" role="img" aria-label={`Schematic gate coverage area, ${location?.radius_meters ?? 50} meter radius`}>
      <span className="location-coverage-circle"><span className="location-coverage-marker" /></span>
      <p>Gate coverage preview · {location?.radius_meters ?? 50} m radius</p>
    </div>
  );
}

function SchoolLocationForm({ location }) {
  const [state, action, isPending] = useActionState(saveSchoolLocation, initialState);
  const idPrefix = location ? `school-location-${location.id}` : "new-school-location";

  return (
    <form className="school-location-form" action={action}>
      {location && <input type="hidden" name="id" value={location.id} />}
      <div className="school-location-fields">
        <label className="form-field" htmlFor={`${idPrefix}-code`}>
          <span className="form-label">Gate code</span>
          <input className="form-input" id={`${idPrefix}-code`} name="code" maxLength={32} defaultValue={location?.code ?? ""} placeholder="GATE-01" required />
        </label>
        <label className="form-field" htmlFor={`${idPrefix}-name`}>
          <span className="form-label">Gate name</span>
          <input className="form-input" id={`${idPrefix}-name`} name="name" maxLength={120} defaultValue={location?.name ?? ""} required />
        </label>
        <label className="form-field" htmlFor={`${idPrefix}-description`}>
          <span className="form-label">Description</span>
          <input className="form-input" id={`${idPrefix}-description`} name="description" maxLength={500} defaultValue={location?.description ?? ""} />
        </label>
        <label className="form-field" htmlFor={`${idPrefix}-latitude`}>
          <span className="form-label">Latitude</span>
          <input className="form-input" id={`${idPrefix}-latitude`} name="latitude" type="number" min="-90" max="90" step="any" defaultValue={location?.latitude ?? ""} required />
        </label>
        <label className="form-field" htmlFor={`${idPrefix}-longitude`}>
          <span className="form-label">Longitude</span>
          <input className="form-input" id={`${idPrefix}-longitude`} name="longitude" type="number" min="-180" max="180" step="any" defaultValue={location?.longitude ?? ""} required />
        </label>
        <label className="form-field" htmlFor={`${idPrefix}-radius`}>
          <span className="form-label">Radius (meters)</span>
          <input className="form-input" id={`${idPrefix}-radius`} name="radiusMeters" type="number" min="1" step="1" defaultValue={location?.radius_meters ?? "150"} required />
        </label>
        <label className="form-field" htmlFor={`${idPrefix}-max-accuracy`}>
          <span className="form-label">Maximum accuracy (meters)</span>
          <input className="form-input" id={`${idPrefix}-max-accuracy`} name="maxAccuracyMeters" type="number" min="1" step="1" defaultValue={location?.max_accuracy_meters ?? "50"} required />
        </label>
        <label className="form-field" htmlFor={`${idPrefix}-boundary-uncertainty`}>
          <span className="form-label">Boundary uncertainty margin (meters)</span>
          <input className="form-input" id={`${idPrefix}-boundary-uncertainty`} name="boundaryUncertaintyMeters" type="number" min="0" step="1" defaultValue={location?.boundary_uncertainty_meters ?? "30"} required />
        </label>
      </div>
      <LocationCoveragePreview location={location} />
      <div className="school-location-actions">
        <label className="school-location-active">
          <input type="checkbox" name="isActive" value="true" defaultChecked={location?.is_active ?? true} />
          Active location
        </label>
        <FormFeedback state={state} />
        <button className="auth-submit school-location-save" type="submit" disabled={isPending}>
          {isPending ? "Saving location..." : location ? "Save changes" : "Add location"}
        </button>
      </div>
    </form>
  );
}

export default function SchoolLocationSettings({ locations, unavailable }) {
  if (unavailable) {
    return <p className="form-feedback form-feedback-error" role="alert">School locations are temporarily unavailable.</p>;
  }

  return (
    <>
      <section className="school-location-section" aria-labelledby="configured-locations-title">
        <div className="officer-section-heading">
          <div>
            <h2 className="panel-title" id="configured-locations-title">Configured locations</h2>
            <p className="panel-subtitle">Active locations define the attendance radius and acceptable device accuracy.</p>
          </div>
          <span className="history-count">{locations.length} locations</span>
        </div>
        {locations.length === 0 ? (
          <p className="empty-state">No school locations have been configured.</p>
        ) : (
          <div className="school-location-list">
            {locations.map((location) => (
              <article className="school-location-row" key={location.id}>
                <div className="school-location-row-heading">
                  <h3 className="session-card-title">{location.name} <span className="gate-code">{location.code}</span></h3>
                  <span className={`session-state ${location.is_active ? "session-state-active" : "session-state-expired"}`}>
                    {location.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="school-location-summary">Radius: {location.radius_meters} meters · Boundary margin: {location.boundary_uncertainty_meters} meters · Maximum accuracy: {location.max_accuracy_meters} meters</p>
                <details className="school-location-edit-details">
                  <summary>Edit location</summary>
                  <SchoolLocationForm location={location} />
                </details>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="school-location-section" aria-labelledby="add-location-title">
        <div className="officer-section-heading">
          <div>
            <h2 className="panel-title" id="add-location-title">Add attendance gate</h2>
            <p className="panel-subtitle">Create a gate, set its location/radius, and configure acceptable location uncertainty.</p>
          </div>
        </div>
        <SchoolLocationForm />
      </section>
    </>
  );
}