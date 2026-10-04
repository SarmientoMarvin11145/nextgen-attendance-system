"use server";

import { revalidatePath } from "next/cache";
import { requireProfileRole } from "@/lib/auth/authorization";
import { attendanceSessionSchema } from "@/lib/auth/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { zonedDateTimeToIso } from "@/lib/time-zone";

function readString(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function getFieldErrors(error) {
  return error.issues.reduce((fieldErrors, issue) => {
    const field = issue.path[0] === "startAt"
      ? "startTime"
      : issue.path[0] === "endAt"
        ? "endTime"
        : issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
    return fieldErrors;
  }, {});
}

export async function createAttendanceSession(_previousState, formData) {
  const profile = await requireProfileRole(["officer", "admin"]);
  const values = {
    title: readString(formData, "title"),
    description: readString(formData, "description"),
    date: readString(formData, "date"),
    endDate: readString(formData, "endDate"),
    startTime: readString(formData, "startTime"),
    endTime: readString(formData, "endTime"),
    startAt: "",
    endAt: "",
    locationRequirement: readString(formData, "locationRequirement"),
    course: readString(formData, "course"),
    year: readString(formData, "year"),
    block: readString(formData, "block"),
    team: readString(formData, "team"),
  };

  let supabase;
  let timeZone;
  try {
    supabase = await createSupabaseServerClient();
    ({ data: timeZone } = await supabase.rpc("get_school_timezone"));
  } catch {
    return {
      status: "error",
      message: "School timezone settings are temporarily unavailable.",
      fieldErrors: {},
      values,
    };
  }

  if (typeof timeZone !== "string") {
    return {
      status: "error",
      message: "School timezone settings are temporarily unavailable.",
      fieldErrors: {},
      values,
    };
  }

  values.startAt = zonedDateTimeToIso(values.date, values.startTime, timeZone);
  values.endAt = zonedDateTimeToIso(values.endDate || values.date, values.endTime, timeZone);
  const allGates = formData.get("allGates") === "on";
  const gateIds = formData.getAll("gateIds").filter((value) => typeof value === "string");
  const gateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (gateIds.some((gateId) => !gateIdPattern.test(gateId))
    || new Set(gateIds).size !== gateIds.length
    || (!allGates && gateIds.length === 0)) {
    return {
      status: "error",
      message: "Select at least one active gate, or choose All Gates.",
      fieldErrors: { gateIds: "Select at least one active gate." },
      values,
    };
  }

  const parsed = attendanceSessionSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error),
      values,
    };
  }

  let data;
  let error;
  try {
    ({ data, error } = await supabase.rpc("create_attendance_session_with_gates", {
      p_title: parsed.data.title,
      p_description: parsed.data.description || null,
      p_start_time: parsed.data.startAt,
      p_end_time: parsed.data.endAt,
      p_location_requirement: parsed.data.locationRequirement,
      p_course_filter: parsed.data.course,
      p_year_filter: parsed.data.year,
      p_block_filter: parsed.data.block,
      p_team_filter: parsed.data.team,
      p_all_gates: allGates,
      p_gate_ids: allGates ? [] : gateIds,
    }));
  } catch {
    return {
      status: "error",
      message: "We could not reach the attendance service. Check your connection and try again.",
      fieldErrors: {},
      values,
    };
  }

  if (error || !data) {
    return {
      status: "error",
      message: error?.message?.includes("gate")
        ? "The selected gates are no longer available. Refresh the page and try again."
        : "Attendance could not be created. Check the dates and try again.",
      fieldErrors: {},
      values,
    };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  return {
    status: "success",
    message: "Attendance session created.",
    fieldErrors: {},
    values: {},
  };
}

export async function setAttendanceSessionGate(_previousState, formData) {
  await requireProfileRole(["officer", "admin"]);
  const sessionId = readString(formData, "sessionId").trim();
  const gateId = readString(formData, "gateId").trim();
  const isOpen = formData.get("isOpen") === "true";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(sessionId) || !uuidPattern.test(gateId)) {
    return { status: "error", message: "Choose a valid session and gate." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_attendance_session_gate", {
      p_session_id: sessionId,
      p_gate_id: gateId,
      p_is_open: isOpen,
    });
    if (error) {
      return { status: "error", message: error.message.includes("At least one gate")
        ? "At least one gate must remain open for this session."
        : "The gate status could not be changed." };
    }
  } catch {
    return { status: "error", message: "We could not update this gate. Check your connection and try again." };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { status: "success", message: isOpen ? "Gate opened for this session." : "Gate closed for this session." };
}

export async function registerAttendanceFromQr(token, expectedSessionId, gateId) {
  await requireProfileRole(["officer", "admin"]);

  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return { status: "error", message: "This QR code is not a valid attendance token." };
  }
  const identifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof expectedSessionId !== "string" || !identifierPattern.test(expectedSessionId)
    || typeof gateId !== "string" || !identifierPattern.test(gateId)) {
    return { status: "error", message: "Choose a valid attendance session and gate." };
  }

  let data;
  let error;
  try {
    const supabase = await createSupabaseServerClient();
    ({ data, error } = await supabase.rpc("register_attendance_from_qr", {
      p_token: token,
      p_expected_session_id: expectedSessionId,
      p_gate_id: gateId,
    }));
  } catch {
    return { status: "error", message: "We could not check this code. Check your connection and try again." };
  }

  if (error) {
    if (error.code === "22023") {
      return { status: "invalid", message: "Invalid or Expired QR Code" };
    }

    if (error.code === "23505") {
      return { status: "already_recorded", message: "Attendance has already been recorded." };
    }

    if (error.code === "42501") {
      return { status: "error", message: "This account is not allowed to record this attendance." };
    }

    return { status: "error", message: "Attendance could not be recorded. Try again later." };
  }

  if (!data || !["recorded", "already_recorded"].includes(data.result)) {
    return { status: "invalid", message: "Invalid or Expired QR Code" };
  }

  return {
    status: data.result,
    firstName: data.first_name,
    lastName: data.last_name,
    course: data.course,
    year: data.year,
    block: data.block,
    team: data.team,
    attendanceStatus: data.attendance_status,
    registeredAt: data.registered_at,
    gateId: data.gate_id,
    gateName: data.gate_name,
    gateCode: data.gate_code,
  };
}