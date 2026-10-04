import AuthPage from "@/components/auth/auth-page";

const attendanceSessionPathPattern = /^\/attendance\/session\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = typeof params.next === "string" && attendanceSessionPathPattern.test(params.next)
    ? params.next
    : "";

  return <AuthPage mode="login" next={next} />;