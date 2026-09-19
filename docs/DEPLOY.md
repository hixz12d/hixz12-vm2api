# 部署

推荐 **Docker Compose**。仓库放在 `/opt/vm2api`。

## 机器

Ubuntu 24.04 或 Debian 12 + Docker Engine。槽位使用所选 `kin-os` 镜像的用户态环境，运行二进制及 glibc 兼容包装由项目提供。

最少三个环境变量，写在仓库 `.env`（`chmod 600`），不要进 git：

```bash
VM2API_API_KEY='很长的随机串'
VM2API_ADMIN_PASSWORD='面板密码'
VM2API_DB_SECRET='再一串'
```

抄本：[deploy/env.example](deploy/env.example)。`VM2API_*` 优先于 `KIN_*`。

## 该看到什么容器

| 容器 | 说明 |
|---|---|
| `vm2api` | 控制面。Compose **只起这一个** |
| `kin-<槽>` | 每个**已启动**的槽 1 个 |
| 没有 | 未启动的槽；同机其它项目的 postgres / newapi 等 |

不是一个父容器里多个子进程。

仓库必须在 `/opt/vm2api`（槽的 `-v` 路径由宿主机 Docker 解释）。挂 `docker.sock`，`network_mode: host`。

## 安装

```bash
git clone https://github.com/dofastted/vm2api.git /opt/vm2api
cd /opt/vm2api
cp .env.example .env
chmod 600 .env
# 填写上面三项

docker compose up -d --build
curl -sS --noproxy '*' http://127.0.0.1:8787/health
```

二进制在仓内 `bin/`，Compose 会拷到挂载目录。`bin/kin-*` 必须 **755**。入口会串行准备面板支持的 Ubuntu、Debian、Arch、Fedora 四种本地槽位镜像，已有镜像跳过。首次启动可能需要较长时间，生产环境建议提前构建。

这些 `kin-os/*` 标签是项目本地构建的镜像，不是公共仓库镜像；缺失时不要执行 `docker login` 或尝试拉取同名镜像。

```bash
# 默认检查并补齐全部四种系统；也可指定 debian / debian-12 / kin-os/debian:12
node docker/kin-os/build.mjs
# 只验证镜像齐全，不构建
node docker/kin-os/build.mjs --check
```

源码和运行目录分离时，上述命令在源码目录执行。可通过 `VM2API_BUILD_BUILDER` 指定已有的 Buildx builder（自动 `--load`），通过 `VM2API_BUILD_CGROUP_PARENT` 指定构建 cgroup。构建前必须在宿主机配置并核实所需的 CPU/内存硬上限；这两个参数只选择 builder/cgroup，不会代为创建资源限制。

生产部署提前构建完镜像后，在控制面 Compose 的 `environment` 中设置 `VM2API_SLOT_IMAGE_MODE: check`，入口只检查镜像，不临时构建。默认值 `build` 会补齐缺少的镜像。创建并开机前也会检查镜像；镜像缺失时不保存槽位、不占用出口，可在补齐镜像后重试。仅创建、暂不开机的槽位不要求镜像已经存在。

升级：`git pull && docker compose up -d --build`。已有槽容器不会被这次 `docker rm`。

Docker Desktop / WSL 下 `curl 127.0.0.1:8787` 可能失败：

```bash
docker exec vm2api python3 -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8787/health").read().decode())'
```

## 上线后

1. 打开 `/console`，用 `VM2API_ADMIN_PASSWORD` 登录。
2. 代理池：添加本地出口，或导入 SOCKS5。
3. 建槽、绑出口、启动。没出口会停在 `stopped`。
4. 在槽里导入凭证，再用 `sk-vm-…` 或 master key 打 `POST /v1/messages`。

没出口或没凭证的槽不会进调度。

## 反代

Node 听 `:8787`。HTTPS 放在 nginx。

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header Authorization $http_authorization;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_read_timeout 600s;
}
```

## 本机 Node（备选）

仓内已有 `bin/kin-*`。还要 `npm ci`、`pnpm -C web install --frozen-lockfile && npm run build:web`，以及占位 `vms/active.json`。单元：[deploy/vm2api.service](deploy/vm2api.service)。细节见 [BUILD.md](BUILD.md)。

---

交流见仓库 [README](../README.md)。
