export default function manifest() {
  return {
    name: "Attendance System",
    short_name: "Attendance",
    description: "Campus attendance and registration workspace.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f2f4ed",
    theme_color: "#20392f",
    icons: [
      { src: "/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
    ],
  };
}