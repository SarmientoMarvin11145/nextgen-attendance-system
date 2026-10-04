import ExcelJS from "exceljs";
import { getAttendanceReport, parseAttendanceReportFilters } from "@/lib/reports/attendance-report";
import { dateInTimeZone } from "@/lib/time-zone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const columns = [
  ["Student", "student"],
  ["Course", "course"],
  ["Year", "year"],
  ["Block", "block"],
  ["Team", "team"],
  ["Attendance Session", "session"],
  ["Gate", "gate"],
  ["Registered At", "registeredAtDisplay"],
  ["Status", "status"],
];

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function dateStamp(timeZone) {
  return dateInTimeZone(new Date(), timeZone);
}

export async function GET(request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "csv" && format !== "xlsx") {
    return Response.json({ error: "Unsupported report format." }, { status: 400 });
  }

  const { filters, rangeError } = parseAttendanceReportFilters(url.searchParams);
  if (rangeError) return Response.json({ error: rangeError }, { status: 400 });

  const report = await getAttendanceReport(filters);
  if (report.error) return Response.json({ error: report.error }, { status: 500 });

  const fileName = `attendance-report-${dateStamp(report.timeZone)}.${format}`;
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="${fileName}"`,
  };
  const columnsForTimeZone = columns.map(([label, key]) => [
    key === "registeredAtDisplay" ? `Registered At (${report.timeZone})` : label,
    key,
  ]);

  if (format === "csv") {
    const csvRows = [
      columnsForTimeZone.map(([label]) => csvCell(label)).join(","),
      ...report.records.map((record) => columnsForTimeZone.map(([, key]) => csvCell(record[key])).join(",")),
    ];
    if (report.truncated) {
      csvRows.push(csvCell("WARNING") + "," + csvCell("Report capped at 50,000 records; narrow the date range for a complete export."));
    }
    return new Response(`\uFEFF${csvRows.join("\r\n")}`, {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Attendance System";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ header: "Statistic", key: "label", width: 28 }, { header: "Value", key: "value", width: 20 }];
  summary.addRows([
    { label: "Total Students", value: report.stats.totalStudents },
    { label: "Present", value: report.stats.present },
    { label: "Late", value: report.stats.late },
    { label: "Absent", value: report.stats.absent },
    { label: "Attendance Percentage", value: `${report.stats.attendancePercentage}%` },
    { label: `Date From (${report.timeZone})`, value: filters.from || "All" },
    { label: `Date To (${report.timeZone})`, value: filters.to || "All" },
    ...(report.truncated ? [{ label: "Warning", value: "Report capped at 50,000 records; narrow the date range for a complete export." }] : []),
  ]);
  summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF20392F" } };
  summary.views = [{ state: "frozen", ySplit: 1 }];

  const details = workbook.addWorksheet("Attendance Details");
  details.columns = columnsForTimeZone.map(([header, key]) => ({ header, key, width: header.length > 16 ? 24 : 18 }));
  details.addRows(report.records);
  details.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  details.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF20392F" } };
  details.views = [{ state: "frozen", ySplit: 1 }];
  details.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + columns.length)}1` };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}