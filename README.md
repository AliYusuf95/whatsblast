# WhatsBlast

WhatsBlast is a powerful WhatsApp automation tool built with modern web technologies. It allows you to send bulk messages, and automate WhatsApp interactions through a user-friendly web interface.

<div style="text-align: center;">

![WhatsBlast Logo](src/logo.svg "WhatsBlast")

</div>

## 🛠️ Tech Stack

- **Frontend:**

  - [React](https://reactjs.org/) - UI Library
  - [Tailwind CSS](https://tailwindcss.com/) - Styling
  - [shadcn/ui](https://ui.shadcn.com/) - UI Components
  - [TanStack Router](https://tanstack.com/router) - Routing
  - [TanStack Query](https://tanstack.com/query) - Data Fetching

- **Backend:**
  - [Bun](https://bun.sh) - JavaScript Runtime
  - [tRPC](https://trpc.io/) - Type-safe API
  - [Puppeteer](https://pptr.dev/) - WhatsApp Automation
  - [Docker](https://www.docker.com/) - Containerization

## ✨ Features

- 📱 WhatsApp Web Integration
- 📨 Bulk Message Sending

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.2.14 or higher)
- [Docker](https://www.docker.com/) (for containerized deployment)
- [Node.js](https://nodejs.org/) (v18 or higher)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/aliyusuf95/whatsblast.git
cd whatsblast
```

2. Install dependencies:

```bash
bun install
```

3. Start development server:

```bash
bun run dev
```

### Docker Deployment

1. Build the Docker image:

```bash
docker build --platform linux/amd64 -f Dockerfile -t whatsblast .
```

2. Run the container:

```bash
docker run --init --platform linux/amd64 -p 3000:3000 whatsblast
```

## 🏗️ Project Structure

```
WhatsBlast/
├── src/
│   ├── components/    # React components
│   ├── server/        # Backend services
│   ├── routes/        # Application routes
│   └── utils/         # Utility functions
├── public/            # Static assets
└── Dockerfile         # Docker configuration
```

## 📝 License

This project is licensed under Apache-2.0 license - see the [LICENSE](LICENSE) file for details.
