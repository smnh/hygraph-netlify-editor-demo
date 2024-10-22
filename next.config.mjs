/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.graphassets.com",
        port: "",
      },
      {
        protocol: "https",
        hostname: "federate-this-astro.vercel.app",
        port: "",
      },
      {
        hostname: 'us-west-2.graphassets.com'
      }
    ],
  },
};

export default nextConfig;
