# Local LiveKit Development Server Setup Guide

This guide details how to run a local LiveKit development server for real-time audio/video calls in this project.

---

## 1. Local Development Topology

- **LiveKit Server**: `ws://localhost:7880` (or `http://localhost:7880`)
- **NestJS Backend**: `http://localhost:5000`
- **Next.js Frontend**: `http://localhost:3000`

### Local Credentials

```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

> [!IMPORTANT]
> **Security Warning**:
> - These credentials are for **LOCAL DEVELOPMENT ONLY**.
> - `LIVEKIT_API_SECRET` must **NEVER** be committed to public git, exposed via the frontend, or prefixed with `NEXT_PUBLIC_`.
> - Only the NestJS backend uses the secret to sign participant JWTs.

---

## 2. Installation & Running LiveKit Locally

### Option A: Direct Binary / CLI (Recommended on Windows)

1. Download the latest Windows release (`livekit_<version>_windows_x86_64.tar.gz` or `.zip`) from the official GitHub Releases:
   [https://github.com/livekit/livekit/releases](https://github.com/livekit/livekit/releases)

2. Extract `livekit-server.exe` into a folder on your `PATH` (or directly into a tools directory).

3. Alternatively, install via Windows Package Manager:
   ```powershell
   winget install LiveKit.LiveKitCLI
   ```

4. Start the server in development mode:
   ```powershell
   livekit-server --dev
   ```

   When started with `--dev`, LiveKit automatically initializes with:
   - **Port**: `7880`
   - **API Key**: `devkey`
   - **API Secret**: `secret`

---

### Option B: Docker (If Docker Desktop is Installed)

If Docker is available on your machine, you can run LiveKit in a single container:

```bash
docker run --rm -it \
  -p 7880:7880 \
  -p 7881:7881 \
  -p 7882:7882/tcp \
  -p 50000-60000:50000-60000/udp \
  livekit/livekit-server --dev
```

---

## 3. Verify Local LiveKit Server

Once started, test that the server is responding:

```powershell
curl http://localhost:7880/
```

Expected output:
```text
OK
```

---

## 4. Backend Configuration

Ensure your `.env` in the backend root contains:

```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

When NestJS boots, `LiveKitService` validates that these credentials are present.
