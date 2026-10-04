"use server";

import { revalidatePath } from "next/cache";
import { requireProfileRole } from "@/lib/auth/authorization";
import { schoolLocationSchema } from "@/lib/auth/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const locationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readString(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveSchoolLocation(_previousState, formData) {
  await requireProfileRole(["admin"]);

  const id = readString(formData, "id").trim();
  const values = {
    code: readString(formData, "code"),
    name: readString(formData, "name"),
    description: readString(formData, "description"),
    latitude: readString(formData, "latitude"),
    longitude: readString(formData, "longitude"),
    radiusMeters: readString(formData, "radiusMeters"),
    maxAccuracyMeters: readString(formData, "maxAccuracyMeters"),
    boundaryUncertaintyMeters: readString(formData, "boundaryUncertaintyMeters"),
  };

  if (id && !locationIdPattern.test(id)) {
    return { status: "error", message: "Choose a valid school location." };
  }

  const parsed = schoolLocationSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message || "Review the location details." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_attendance_gate", {
      p_gate_id: id || null,
      p_code: parsed.data.code,
      p_name: parsed.data.name,
      p_description: parsed.data.description,
      p_latitude: parsed.data.latitude,
      p_longitude: parsed.data.longitude,
      p_radius_meters: parsed.data.radiusMeters,
      p_max_accuracy_meters: parsed.data.maxAccuracyMeters,
      p_boundary_uncertainty_meters: parsed.data.boundaryUncertaintyMeters,
      p_is_active: formData.get("isActive") === "true",
    });

    if (error || !data) {
      return { status: "error", message: error?.code === "23505" ? "That gate code is already in use." : "The attendance gate could not be saved. Check the details and try again." };
    }
  } catch {
    return { status: "error", message: "We could not reach gate settings. Check your connection and try again." };
  }

  revalidatePath("/admin/settings/gates");
  revalidatePath("/admin/settings/locations");

  return {
    status: "success",
    message: id ? "Attendance gate updated." : "Attendance gate added.",
  };
}