import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pg", "pg-boss", "exceljs", "@react-pdf/renderer", "nodemailer"],
};

export default config;
