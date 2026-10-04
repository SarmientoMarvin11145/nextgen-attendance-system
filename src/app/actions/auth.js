"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { requireProfileRole } from "@/lib/auth/authorization";
import { loginSchema, passwordResetSchema, passwordUpdateSchema, registrationSchema, studentProfileSchema } from "@/lib/auth/validation";
import { sendWelcomeEmail } from "@/lib/email/resend";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function readString(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function recordLocationAttempt(supabase, sessionId, outcome, distance, accuracy) {
  try {
    await supabase.rpc("record_location_verification_attempt", {
      p_session_id: sessionId,
      p_outcome: outcome,
      p_distance_meters: distance ?? null,
      p_accuracy_meters: accuracy ?? null,
    });
  } catch {
    return;
  }
}

function getFieldErrors(error) {
  return error.issues.reduce((fieldErrors, issue) => {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
    return fieldErrors;
  }, {});
}

function submittedRegistrationValues(formData) {
  return {
    firstName: readString(formData, "firstName").trim(),
    lastName: readString(formData, "lastName").trim(),
    email: readString(formData, "email").trim(),
    course: readString(formData, "course").trim(),
    year: readString(formData, "year").trim(),
    block: readString(formData, "block").trim(),
    team: readString(formData, "team").trim(),
  };
}

function authFailureMessage(error, operation) {
  if (error.status === 429) {
    return "Too many attempts. Wait a moment and try again.";
  }

  if (operation === "login" && error.code === "email_not_confirmed") {
    return "Confirm your email address before signing in.";
  }

  if (operation === "login") {
    return "Email or password is incorrect.";
  }

  if (/already registered|already exists/i.test(error.message)) {
    return "This account could not be created. If this email is already registered, sign in instead.";
  }

  if (/password/i.test(error.message)) {
    return "Password does not meet the Supabase project's password policy.";
  }

  return "We could not create your account. Check your details and try again.";
}

const attendanceSessionPathPattern = /^\/attendance\/session\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function registerStudent(_previousState, formData) {
  const values = submittedRegistrationValues(formData);
  const parsed = registrationSchema.safeParse({
    ...values,
    password: readString(formData, "password"),
    confirmPassword: readString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error),
      values,
    };
  }

  let supabase;
  let data;
  let error;
  try {
    supabase = await createSupabaseServerClient();
    ({ data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: {
          first_name: parsed.data.firstName,
          last_name: parsed.data.lastName,
          course: parsed.data.course,
          year: parsed.data.year,
          block: parsed.data.block,
          team: parsed.data.team,
        },
      },
    }));
  } catch {
    return {
      status: "error",
      message: "We could not reach the registration service. Check your connection and try again.",
      fieldErrors: {},
      values,
    };
  }

  if (error) {
    return {
      status: "error",
      message: authFailureMessage(error, "register"),
      fieldErrors: {},
      values,
    };
  }

  const isNewAccount = data.user && (!Array.isArray(data.user.identities) || data.user.identities.length > 0);
  if (isNewAccount) {
    await sendWelcomeEmail(parsed.data.email, parsed.data.firstName);
  }

  if (data.session) {
    redirect("/dashboard");
  }

  return {
    status: "success",
    message: "Account created. Check your email for a confirmation link before signing in.",
    fieldErrors: {},
    values,
  };
}

export async function signIn(_previousState, formData) {
  const values = { email: readString(formData, "email").trim() };
  const next = readString(formData, "next");
  const parsed = loginSchema.safeParse({
    email: values.email,
    password: readString(formData, "password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error),
      values,
    };
  }

  const supabase = await createSupabaseServerClient();
  let data;
  let error;
  try {
    ({ data, error } = await supabase.auth.signInWithPassword(parsed.data));
  } catch {
    return {
      status: "error",
      message: "We could not reach the sign-in service. Check your connection and try again.",
      fieldErrors: {},
      values,
    };
  }

  if (error) {
    return {
      status: "error",
      message: authFailureMessage(error, "login"),
      fieldErrors: {},
      values,
    };
  }

  let profile;
  let profileError;
  try {
    ({ data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle());
  } catch {
    profileError = true;
  }

  if (profileError || !profile) {
    try {
      await supabase.auth.signOut();
    } catch {
      return {
        status: "error",
        message: "Your profile could not be loaded. Check your connection and try again.",
        fieldErrors: {},
        values,
      };
    }
    return {
      status: "error",
      message: "Your account profile is not available. Contact an administrator.",
      fieldErrors: {},
      values,
    };
  }

  if (profile.role === "student" && attendanceSessionPathPattern.test(next)) {
    redirect(next);
  }

  redirect(profile.role === "student" ? "/dashboard" : "/admin");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_previousState, formData) {
  const parsed = passwordResetSchema.safeParse({ email: readString(formData, "email") });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid email address.",
      fieldErrors: getFieldErrors(parsed.error),
      values: { email: readString(formData, "email").trim() },
    };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const redirectTo = siteUrl ? `${siteUrl}/auth/callback?next=/update-password` : undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      redirectTo ? { redirectTo } : undefined
    );
    if (error) {
      return {
        status: "error",
        message: error.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "We could not send reset instructions right now. Try again later.",
        fieldErrors: {},
        values: {},
      };
    }
  } catch {
    return {
      status: "error",
      message: "We could not reach the account service. Check your connection and try again.",
      fieldErrors: {},
      values: { email: parsed.data.email },
    };
  }

  return {
    status: "success",
    message: "If an account exists for that email, password reset instructions will be sent.",
    fieldErrors: {},
    values: {},
  };
}

export async function updatePassword(_previousState, formData) {
  await requireProfileRole(["student", "officer", "admin"]);
  const parsed = passwordUpdateSchema.safeParse({
    password: readString(formData, "password"),
    confirmPassword: readString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error),
      values: {},
    };
  }

  let error;
  try {
    const supabase = await createSupabaseServerClient();
    ({ error } = await supabase.auth.updateUser({ password: parsed.data.password }));
  } catch {
    return {
      status: "error",
      message: "We could not reach the account service. Check your connection and try again.",
      fieldErrors: {},
      values: {},
    };
  }

  if (error) {
    return {
      status: "error",
      message: /password/i.test(error.message)
        ? "The new password does not meet your account's password requirements."
        : "The password could not be updated. Request a new reset link and try again.",
      fieldErrors: {},
      values: {},
    };
  }

  redirect("/login?passwordUpdated=1");
}

export async function issueStudentQr(_previousState, formData) {
  await requireProfileRole(["student"]);
  const sessionId = readString(formData, "sessionId").trim();
  const latitudeValue = readString(formData, "latitude").trim();
  const longitudeValue = readString(formData, "longitude").trim();
  const accuracyValue = readString(formData, "accuracy").trim();
  const hasAnyLocation = Boolean(latitudeValue || longitudeValue || accuracyValue);
  const hasCompleteLocation = Boolean(latitudeValue && longitudeValue && accuracyValue);
  const latitude = hasCompleteLocation ? Number(latitudeValue) : null;
  const longitude = hasCompleteLocation ? Number(longitudeValue) : null;
  const accuracy = hasCompleteLocation ? Number(accuracyValue) : null;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return { status: "error", message: "Choose a valid attendance session.", sessionId };
  }

  if (hasAnyLocation && (!hasCompleteLocation
    || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !Number.isFinite(accuracy) || accuracy < 0)) {
    return { status: "error", message: "Your location could not be verified. Try again.", sessionId };
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
    if (hasCompleteLocation) {
      await supabase.rpc("record_location_permission_submission", { p_session_id: sessionId });
    }
  } catch {
    if (!supabase) {
      return {
        status: "error",
        message: "No Internet Connection. Attendance verification requires an active internet connection. Please reconnect and try again.",
        sessionId,
      };
    }
  }

  let issued;
  let error;
  let locationUncertain = false;
  try {
    ({ data: issued, error } = await supabase.rpc("issue_attendance_qr", {
      p_session_id: sessionId,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy: accuracy,
    }));
  } catch {
    return {
      status: "error",
      message: "No Internet Connection. Attendance verification requires an active internet connection. Please reconnect and try again.",
      sessionId,
    };
  }

  if (error?.code === "P0001" && /boundary/i.test(error.message ?? "")) {
    locationUncertain = true;
    try {
      ({ data: issued, error } = await supabase.rpc("issue_attendance_qr", {
        p_session_id: sessionId,
        p_latitude: null,
        p_longitude: null,
        p_accuracy: null,
      }));
    } catch {
      return { status: "error", message: "Location could not be verified. Try again while connected to the internet.", sessionId };
    }

    if (issued?.status === "invalid_location") {
      return {
        status: "location_uncertain",
        message: "Your location is too close to the attendance boundary to confidently verify. Move further inside the campus and try again.",
        sessionId,
      };
    }
  }

  if (issued?.status === "accuracy_too_low") {
    await recordLocationAttempt(supabase, sessionId, "accuracy_too_low", null, issued.accuracy);
    return {
      status: "accuracy_too_low",
      message: "Your device currently reports an uncertain location. Turn on Location Services, move to an area with better GPS reception, and try again.",
      sessionId,
      accuracy: issued.accuracy,
      maximumAccuracy: issued.maximum_accuracy,
    };
  }

  if (issued?.status === "outside_area") {
    await recordLocationAttempt(supabase, sessionId, "outside_area", issued.distance, accuracy);
    return {
      status: "outside_area",
      message: "You appear to be outside the authorized attendance area. Move inside the authorized attendance area and try again.",
      sessionId,
      distance: issued.distance,
      requiredRadius: issued.required_radius,
      gateName: issued.gate_name,
      gateCode: issued.gate_code,
    };
  }

  if (issued?.status === "location_uncertain") {
    await recordLocationAttempt(supabase, sessionId, "location_uncertain", issued.distance, accuracy);
    return {
      status: "location_uncertain",
      message: "Your location is too close to a gate boundary to confidently verify. Move closer to a gate and try again.",
      sessionId,
      distance: issued.distance,
      requiredRadius: issued.required_radius,
      gateName: issued.gate_name,
      gateCode: issued.gate_code,
    };
  }

  if (issued?.status === "location_unavailable") {
    await recordLocationAttempt(supabase, sessionId, "location_unavailable", null, accuracy);
    return { status: "error", message: "Attendance location is not configured. Contact an administrator.", sessionId };
  }

  if (issued?.status === "invalid_location") {
    await recordLocationAttempt(supabase, sessionId, locationUncertain ? "location_uncertain" : "invalid_location", null, accuracy);
    if (locationUncertain) {
      return {
        status: "location_uncertain",
        message: "Your location is too close to the attendance boundary to confidently verify. Move further inside the campus and try again.",
        sessionId,
      };
    }
    return { status: "error", message: "Your location could not be verified. Try again.", sessionId };
  }

  if (issued?.status === "issued_unverified" && issued.reason !== "location_disabled") {
    await recordLocationAttempt(
      supabase,
      sessionId,
      locationUncertain ? "location_uncertain" : issued.reason || "location_not_provided",
      issued.distance,
      issued.accuracy
    );
  }

  const token = issued?.token;
  const expiresAt = issued?.expires_at;

  if (error || typeof token !== "string" || typeof expiresAt !== "string") {
    const rateLimited = error?.code === "P0001";
    const alreadyRegistered = error?.code === "23505";
    const notEligible = error?.code === "42501";
    return {
      status: alreadyRegistered ? "already_registered" : "error",
      message: alreadyRegistered
        ? "Your attendance has already been recorded for this session."
        : rateLimited
          ? "QR request limit reached. Wait before requesting another code."
          : notEligible
            ? "You are not eligible for this attendance session."
            : "A QR code could not be issued. Check that the session is active and try again.",
      sessionId,
    };
  }

  let qrDataUrl;
  try {
    qrDataUrl = await QRCode.toDataURL(token, {
      width: 224,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#20392f", light: "#fffefa" },
    });
  } catch {
    return { status: "error", message: "The QR code could not be rendered. Try again.", sessionId };
  }

  return {
    status: "success",
    message: locationUncertain
      ? "Your QR is ready, but your location could not be confidently verified."
      : "Show this one-time code to the attendance officer.",
    sessionId,
    qrDataUrl,
    expiresAt,
    distance: issued.distance,
    accuracy: issued.accuracy,
    requiredRadius: issued.required_radius,
    maximumAccuracy: issued.maximum_accuracy,
    locationVerified: issued.status === "issued",
    locationReason: locationUncertain ? "location_uncertain" : issued.reason,
    gateId: issued.gate_id,
    gateName: issued.gate_name,
    gateCode: issued.gate_code,
  };
}

export async function saveStudentProfile(_previousState, formData) {
  const profile = await requireProfileRole(["student"]);
  const values = {
    firstName: readString(formData, "firstName"),
    lastName: readString(formData, "lastName"),
    course: readString(formData, "course"),
    year: readString(formData, "year"),
    block: readString(formData, "block"),
    team: readString(formData, "team"),
  };
  const parsed = studentProfileSchema.safeParse(values);

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
    const supabase = await createSupabaseServerClient();
    ({ data, error } = await supabase
      .from("profiles")
      .update({
        first_name: parsed.data.firstName,
        last_name: parsed.data.lastName,
        course: parsed.data.course,
        year: parsed.data.year,
        block: parsed.data.block,
        team: parsed.data.team,
      })
      .eq("id", profile.id)
      .select("id")
      .maybeSingle());
  } catch {
    return {
      status: "error",
      message: "We could not reach your profile service. Check your connection and try again.",
      fieldErrors: {},
      values: parsed.data,
    };
  }

  if (error || !data) {
    return {
      status: "error",
      message: "Your changes could not be saved. Please try again.",
      fieldErrors: {},
      values: parsed.data,
    };
  }

  revalidatePath("/dashboard");

  return {
    status: "success",
    message: "Personal information saved.",
    fieldErrors: {},
    values: parsed.data,
  };
}