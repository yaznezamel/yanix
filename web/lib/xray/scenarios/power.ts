import { NET, dhcp, eth, frame, ipv4, udp } from "../packets";
import { dataFrame, dbusCall, pm1Control } from "../structs";
import type { MachineState, NodeId, Scenario, Step } from "../types";
import { INPUT_PATH, clickStep } from "./common";

// Powering on, logging in, powering off. The boot follows a UEFI x86-64 PC:
// firmware, bootloader, kernel, initramfs, systemd, then DHCP and the login
// screen. Shutdown runs the other way and ends with the ACPI soft-off state.

/** What RAM forgets when the power goes: everything this computer cached. */
const FORGOTTEN: Partial<MachineState> = { arpCached: false, connectionOpen: false, pageCache: [] };

// Illustrative console lines in the formats the kernel and systemd print;
// device names, numbers and versions vary from machine to machine.
const LOG_KERNEL = [
  "Linux version 7.2.0 (simulated console)",
  "Command line: BOOT_IMAGE=/vmlinuz root=UUID=… ro",
  "Memory: …K/…K available",
  "smp: Brought up 1 node, 4 CPUs",
];
const LOG_DRIVERS = [
  "nvme nvme0: … default/read/poll queues",
  "[drm] Initialized … for 0000:00:02.0 on minor 0",
  "snd_hda_intel 0000:00:1f.3: …",
  "usb 1-1: new full-speed USB device number 2 using xhci_hcd",
  "input: USB Keyboard as /devices/…/input/input3",
  "r8169 0000:03:00.0 eth0: …, 00:00:5e:00:53:01, IRQ …",
];
const LOG_INITRAMFS = ["Unpacking initramfs...", "Run /init as init process"];
const LOG_ROOT = ["EXT4-fs (nvme0n1p2): mounted filesystem …", "Switching root."];
const LOG_SYSTEMD = [
  "systemd … running in system mode",
  "[  OK  ] Started Journal Service.",
  "[  OK  ] Started Rule-based Manager for Device Events and Files.",
  "[  OK  ] Started Network Manager.",
  "[  OK  ] Started User Login Management.",
];
const LOG_GRAPHICAL = ["[  OK  ] Started GNOME Display Manager.", "[  OK  ] Reached target Graphical Interface."];

const DHCP_OUT: NodeId[] = ["services", "syscall", "socket", "nicdrv", "nic", "router"];
const DHCP_IN: NodeId[] = ["router", "nic", "irq", "nicdrv", "socket", "syscall", "services"];

function dhcpOut(type: "DISCOVER" | "REQUEST", caption: string) {
  return [
    frame(2, caption, ipv4("0.0.0.0", "255.255.255.255", "UDP"), udp(68, 67), dhcp(type)),
    frame(3, caption, eth("broadcast", "IPv4"), ipv4("0.0.0.0", "255.255.255.255", "UDP"), udp(68, 67), dhcp(type)),
  ];
}

function dhcpIn(type: "OFFER" | "ACK", caption: string) {
  return [
    frame(0, caption, eth("host", "IPv4"), ipv4(NET.router.ip, NET.host.ip, "UDP"), udp(67, 68), dhcp(type)),
    frame(3, caption, ipv4(NET.router.ip, NET.host.ip, "UDP"), udp(67, 68), dhcp(type)),
  ];
}

/** From the reset vector to the login screen. */
function bootSteps(): Step[] {
  return [
    {
      id: "reset-vector",
      phase: "firmware",
      path: ["pmc", "cpu", "firmware"],
      title: "The first instruction",
      body: "Out of reset, an x86 CPU starts fetching at a fixed address just below 4 GiB, the reset vector, which the chipset maps to the firmware's flash chip. (On many machines a security processor checked that firmware first.) RAM isn't usable yet.",
      timescale: "us",
    },
    {
      id: "uefi",
      phase: "firmware",
      path: ["firmware", "cpu", "ram"],
      title: "UEFI wakes the hardware",
      body: "The UEFI firmware trains the memory controller so RAM works, starts the other cores and walks the PCIe buses to find the GPU, the SSD and the USB controller. This is when the logo appears.",
      timescale: "s",
      aws: {
        service: "Amazon EC2",
        text: "EC2 instances boot the same way: an AMI's boot mode says legacy BIOS or UEFI, and UEFI is the default on Graviton (Arm) instance types. The firmware runs inside the virtual machine, before your operating system.",
        source: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ami-boot.html",
      },
      ui: { screen: "firmware", clearBootLog: true },
    },
    {
      id: "boot-entry",
      phase: "firmware",
      path: ["firmware", "ssd"],
      title: "Finding a bootloader",
      body: "The firmware reads its boot order from NVRAM, finds the EFI system partition on the SSD (a small FAT32 partition) and loads the bootloader from it, an ordinary EFI program. With Secure Boot on, it checks the program's signature first.",
      timescale: "ms",
      aws: {
        service: "Amazon EC2",
        text: "EC2 supports UEFI Secure Boot too: the keys the firmware checks the bootloader against are stored with the AMI, in its UEFI variable store.",
      },
    },
    {
      id: "bootloader",
      phase: "boot",
      path: ["ssd", "ram", "cpu"],
      title: "The bootloader loads Linux",
      body: "The bootloader (GRUB on many distributions) shows its menu, then reads two files into RAM: the kernel image (vmlinuz) and the initial RAM filesystem (initramfs). It starts the kernel with a command line such as root=UUID=…",
      timescale: "s",
      ui: { screen: "bootloader" },
    },
    {
      id: "kernel",
      phase: "boot",
      path: ["cpu", "mm", "sched", "irq"],
      title: "Linux starts",
      body: "The kernel's EFI stub collects the memory map from the firmware and hands over to the kernel proper. start_kernel() brings up the essentials in order: memory management, the scheduler, interrupts and timers. The firmware's boot services are done.",
      code: [
        { project: "linux", path: "drivers/firmware/efi/libstub/x86-stub.c", symbol: "efi_stub_entry" },
        { project: "linux", path: "init/main.c", symbol: "start_kernel" },
      ],
      timescale: "ms",
      aws: {
        service: "Amazon EC2",
        text: "On EC2 you can read these console lines without logging in: Get system log (GetConsoleOutput) returns what the instance printed to its serial console, and EC2 Serial Console lets you type into it.",
      },
      ui: { screen: "kernel", bootLog: LOG_KERNEL },
    },
    {
      id: "drivers",
      phase: "boot",
      path: ["nvme", "drm", "alsa", "usbdrv", "nicdrv"],
      title: "Finding the hardware",
      body: "The kernel enumerates the PCI buses and matches every device with a driver: NVMe for the SSD, the GPU's DRM driver, HD Audio for sound, xHCI for USB, and the network card's driver. Each driver's probe() function sets its device up.",
      code: [
        { project: "linux", path: "drivers/pci/probe.c", symbol: "pci_scan_child_bus" },
        { project: "linux", path: "drivers/base/dd.c", symbol: "really_probe" },
      ],
      timescale: "ms",
      aws: {
        service: "AWS Nitro System",
        text: "On a Nitro-based instance the list is short: EBS volumes and instance store appear as NVMe devices, and the network card is ENA, so this kernel's nvme and ena drivers find them like any PCI device.",
      },
      ui: { bootLog: LOG_DRIVERS },
    },
    {
      id: "initramfs",
      phase: "boot",
      path: ["ram", "vfs", "proc"],
      title: "A temporary root filesystem",
      body: "The kernel unpacks the initramfs into a filesystem in RAM and runs its /init as the very first process, PID 1. Its job is to find and mount the real root filesystem, which may need extra drivers or decryption first.",
      code: [
        { project: "linux", path: "init/initramfs.c", symbol: "populate_rootfs" },
        { project: "linux", path: "init/main.c", symbol: "kernel_init" },
      ],
      timescale: "ms",
      ui: { bootLog: LOG_INITRAMFS },
    },
    {
      id: "root",
      phase: "boot",
      path: ["proc", "vfs", "ext4", "block", "nvme", "ssd"],
      title: "Mounting the real root",
      body: "The initramfs finds the root partition by its UUID, mounts it (ext4 here), switches to it and executes the real init: systemd, which stays PID 1 until the computer shuts down.",
      timescale: "ms",
      aws: {
        service: "Amazon EBS",
        text: "On EC2 the root filesystem usually lives on an EBS volume. It is found by UUID here for a reason AWS also gives: NVMe device names such as /dev/nvme1n1 can change from one boot to the next.",
      },
      ui: { bootLog: LOG_ROOT },
    },
    {
      id: "systemd",
      phase: "services",
      path: ["proc", "syscall", "services"],
      title: "systemd starts the system",
      body: "systemd reads its unit files and starts services in parallel, as their dependencies allow: udev to set up devices, journald for logs, the network manager, logind for user sessions and the display manager.",
      code: [{ project: "systemd", path: "src/core/main.c" }],
      timescale: "s",
      aws: {
        service: "Amazon EC2",
        text: "On an EC2 instance one more service runs here: cloud-init, which reads your user data from the instance metadata service at 169.254.169.254 and runs your setup script on the first boot.",
      },
      ui: { bootLog: LOG_SYSTEMD },
    },
    {
      id: "dhcp-discover",
      phase: "dhcp",
      path: DHCP_OUT,
      frames: dhcpOut("DISCOVER", "DHCP DISCOVER: any address for me?"),
      title: "DHCP: asking for an address",
      body: "The network manager has no IP address yet, so the normal network stack can't send for it. It builds the IP and UDP headers itself and sends a DHCP DISCOVER through a packet socket: from 0.0.0.0 to 255.255.255.255, everyone on the local network.",
      code: [
        { project: "systemd", path: "src/libsystemd-network/dhcp-client-send.c", symbol: "client_send_raw" },
        { project: "linux", path: "net/packet/af_packet.c", symbol: "packet_sendmsg" },
      ],
      timescale: "ms",
      data: {
        amount: "240 bytes + options",
        what: "a DHCP message's fixed part (RFC 2131): 236 bytes of BOOTP fields, 192 of them the empty server-name and boot-file fields, and a 4-byte magic cookie. Then options such as the message type, plus 28 bytes of IP and UDP headers.",
      },
    },
    {
      id: "dhcp-offer",
      phase: "dhcp",
      path: DHCP_IN,
      frames: dhcpIn("OFFER", "DHCP OFFER: 192.168.1.23 is free"),
      title: "The router offers 192.168.1.23",
      body: "The router's DHCP server picks a free address, 192.168.1.23, and offers it. The reply comes up the receive path to the packet socket the network manager is waiting on.",
      code: [{ project: "linux", path: "net/packet/af_packet.c", symbol: "packet_rcv" }],
      timescale: "ms",
      aws: {
        service: "Amazon VPC",
        text: "In a VPC the instance asks the same way, but the answer is settled in advance: a network interface gets its private address when it is created, and DHCP only tells the instance what it already has.",
      },
    },
    {
      id: "dhcp-request",
      phase: "dhcp",
      mode: "deep",
      path: DHCP_OUT,
      frames: dhcpOut("REQUEST", "DHCP REQUEST: I'll take it"),
      title: "REQUEST: “I'll take it”",
      body: "The network manager asks for 192.168.1.23 with a DHCP REQUEST, still broadcast, so any other DHCP server that made an offer learns it wasn't chosen.",
      timescale: "ms",
    },
    {
      id: "dhcp-ack",
      phase: "dhcp",
      path: DHCP_IN,
      frames: dhcpIn("ACK", "DHCP ACK: the address is yours"),
      title: "ACK: the address is ours",
      body: "The router confirms with an ACK carrying the address, the gateway (192.168.1.1), the DNS server and a lease time. The network manager configures eth0 with it, and from now on the normal stack, ARP included, does the work.",
      timescale: "ms",
      aws: {
        service: "VPC DHCP option sets",
        text: "On EC2, what the ACK carries comes from the VPC's DHCP option set: the DNS servers (AmazonProvidedDNS unless you change them), the domain name, and NTP servers if you set any.",
      },
    },
    {
      id: "greeter",
      phase: "login",
      path: ["services", "shell", "syscall", "drm", "display"],
      title: "The login screen",
      body: "The display manager (GDM, for example) starts a compositor for the login screen. It opens the GPU through DRM, sets the display mode (kernel mode setting) and draws the greeter.",
      code: [{ project: "linux", path: "drivers/gpu/drm/drm_atomic_uapi.c", symbol: "drm_mode_atomic_ioctl" }],
      timescale: "ms",
      ui: { bootLog: LOG_GRAPHICAL, screen: "login" },
    },
    {
      id: "boot-done",
      phase: "login",
      path: ["shell"],
      title: "Ready for you",
      body: "Power button to login screen: firmware, bootloader, kernel, initramfs, systemd and its services. RAM started empty, so nothing is cached: no files, no ARP entries, no connections. The machine learns them all again.",
      aws: {
        service: "EC2 Auto Scaling warm pools",
        text: "Every boot starts cold, which is why EC2 Auto Scaling offers warm pools: instances booted and initialized ahead of time, then kept stopped or running, so they join faster than a fresh launch.",
      },
    },
  ];
}

export function boot(): Scenario {
  const steps: Step[] = [
    {
      id: "power-button",
      phase: "power",
      path: ["pmc"],
      title: "You press the power button",
      body: "The button is wired to the chipset's power management, which runs on standby power even when the computer is off. It switches the power supply on; once the voltages are stable, the supply reports “power good” and the chipset lets the CPU out of reset.",
      timescale: "ms",
      aws: {
        service: "Amazon EC2",
        text: "An EC2 instance has no power button: StartInstances asks AWS to power on its virtual machine on a Nitro host, and the same firmware-to-login sequence then runs inside it.",
      },
    },
    ...bootSteps(),
  ];
  return { kind: "boot", app: null, title: "Starting the computer", focus: "split", steps };
}

export function login(): Scenario {
  const steps: Step[] = [
    {
      id: "password",
      phase: "input",
      path: INPUT_PATH,
      title: "You type your password",
      body: "The keys take the input path to the compositor, which runs the login screen itself, so nothing else sees them.",
      code: [{ project: "linux", path: "drivers/input/evdev.c", symbol: "evdev_read" }],
      timescale: "ms",
    },
    {
      id: "pam",
      phase: "login",
      path: ["shell", "services", "syscall", "vfs"],
      title: "Checking your password",
      body: "The display manager hands the password to PAM, the pluggable authentication modules. pam_unix reads your entry in /etc/shadow, hashes what you typed with the same salt and method (yescrypt on many current distributions) and compares the two. The password itself is never stored.",
      code: [
        { project: "linux-pam", path: "modules/pam_unix/pam_unix_auth.c", symbol: "pam_sm_authenticate" },
        { project: "linux-pam", path: "modules/pam_unix/passverify.c", symbol: "verify_pwd_hash" },
      ],
      timescale: "ms",
      aws: {
        service: "EC2 Instance Connect",
        text: "Logging in to an EC2 instance usually means SSH with a key, not a password. EC2 Instance Connect pushes a one-time public key into the instance metadata, where it stays usable for 60 seconds, and sshd checks your login against it.",
        source: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-methods.html",
      },
    },
    {
      id: "session",
      phase: "login",
      path: ["services"],
      title: "A session for you",
      body: "logind registers a session for your user and gives it the seat's devices, so your compositor may open the GPU and the input devices. systemd starts your user manager, which starts your own services, PipeWire among them.",
      code: [{ project: "systemd", path: "src/login/logind-session.c", symbol: "session_start" }],
      timescale: "ms",
    },
    {
      id: "desktop",
      phase: "login",
      path: ["services", "shell", "syscall", "drm", "display"],
      title: "Your desktop",
      body: "Your session's desktop shell starts, takes over the GPU and the input devices, and draws the desktop. You're in.",
      code: [{ project: "linux", path: "drivers/gpu/drm/drm_atomic_uapi.c", symbol: "drm_mode_atomic_ioctl" }],
      timescale: "s",
      ui: { screen: "desktop", windows: { welcome: "open" } },
    },
  ];
  return { kind: "login", app: null, title: "Logging in", focus: "split", steps };
}

function shutdownSteps(restart: boolean): Step[] {
  const verb = restart ? "Restart" : "Shut down";
  const method = restart ? "Reboot" : "PowerOff";
  const target = restart ? "reboot.target" : "poweroff.target";
  const command = restart ? "LINUX_REBOOT_CMD_RESTART" : "LINUX_REBOOT_CMD_POWER_OFF";
  const steps: Step[] = [
    clickStep("click", "shell", `You choose ${verb}`, `${verb} in the power menu`),
    {
      id: "logind",
      phase: "shutdown",
      path: ["shell", "syscall", "ipc", "syscall", "services"],
      frames: [dataFrame(0, "D-Bus message", `${method}() to logind`, dbusCall(method, "interactive: true"))],
      title: "Asking logind",
      body: `The shell sends logind a D-Bus message, ${method}(); D-Bus is a message bus that runs over Unix sockets. logind checks that you're allowed (polkit) and whether any app holds an inhibitor lock to delay it, then asks systemd to start ${target}.`,
      code: [{ project: "systemd", path: "src/login/logind-dbus.c", symbol: restart ? "method_reboot" : "method_poweroff" }],
      timescale: "ms",
      aws: {
        service: "EC2 Auto Scaling lifecycle hooks",
        text: "An inhibitor lock delays a shutdown so an app can finish its work. Lifecycle hooks do the same for Auto Scaling: they hold a terminating instance in a wait state, for one hour by default, until your script says it's done.",
        source: "https://docs.aws.amazon.com/autoscaling/ec2/userguide/adding-lifecycle-hooks.html",
      },
    },
    {
      id: "apps-quit",
      phase: "shutdown",
      path: ["services", "syscall", "proc"],
      title: "Every app is asked to quit",
      body: "systemd stops units in reverse dependency order. Each process of your session gets SIGTERM, a polite request to exit, so apps can save and close. Whatever still runs after a timeout gets SIGKILL, which can't be refused.",
      code: [{ project: "linux", path: "kernel/signal.c", symbol: "send_signal_locked" }],
      timescale: "s",
      aws: {
        service: "Amazon EC2 Spot Instances",
        text: "A Spot Instance gets the same courtesy on a larger scale: a two-minute interruption notice, through instance metadata and EventBridge, before AWS stops or terminates it.",
        source: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html",
      },
      learns: { connectionOpen: false },
      ui: { closeAll: true, screen: "shutdown" },
    },
    {
      id: "services-stop",
      phase: "shutdown",
      path: ["services"],
      title: "Services stop",
      body: "The display manager, the network manager and the other services stop in turn, and the network link goes down. The journal writes its last messages.",
      timescale: "s",
    },
    {
      id: "sync",
      phase: "shutdown",
      path: ["services", "syscall", "vfs", "pagecache", "ext4", "block", "nvme", "ssd"],
      title: "Writing back dirty pages",
      body: "Recently written data may still live only in the page cache, as dirty pages waiting to be written. systemd's last stage calls sync(): the kernel writes every dirty page and the ext4 journal to the SSD. Then the filesystems are unmounted, the root remounted read-only.",
      code: [
        { project: "linux", path: "fs/sync.c", symbol: "ksys_sync" },
        { project: "systemd", path: "src/shutdown/shutdown.c" },
      ],
      timescale: "ms",
      aws: {
        service: "Amazon EBS snapshots",
        text: "An EBS snapshot captures what has reached the volume, not dirty pages still in the instance's page cache. That is why AWS suggests flushing, or stopping the instance, before a snapshot you need to be complete.",
      },
    },
    {
      id: "reboot-call",
      phase: "shutdown",
      path: ["services", "syscall", "acpi"],
      title: `reboot(${restart ? "RESTART" : "POWER_OFF"})`,
      body: `systemd-shutdown, by now the last process left, calls the reboot() system call with ${command}. The kernel takes it from here.`,
      code: [
        { project: "linux", path: "kernel/reboot.c", symbol: restart ? "kernel_restart" : "kernel_power_off" },
        { project: "linux", path: "include/uapi/linux/reboot.h" },
      ],
      timescale: "ms",
      aws: {
        service: "Amazon EC2",
        text: "RebootInstances asks the operating system to restart cleanly, through this same path; if it hasn't shut down within a few minutes, EC2 performs a hard reboot instead.",
      },
    },
    {
      id: "device-shutdown",
      phase: "shutdown",
      path: ["acpi", "nvme", "ssd"],
      title: "Drivers put devices to rest",
      body: "The kernel runs every driver's shutdown hook. The NVMe driver, for one, tells the SSD to shut down cleanly so it can save its own caches and mapping tables.",
      code: [
        { project: "linux", path: "drivers/base/core.c", symbol: "device_shutdown" },
        { project: "linux", path: "drivers/nvme/host/pci.c", symbol: "nvme_shutdown" },
      ],
      timescale: "ms",
    },
  ];
  if (restart) {
    steps.push({
      id: "reset",
      phase: "power",
      path: ["acpi", "pmc", "cpu"],
      title: "Reset",
      body: "Instead of powering off, the kernel resets the machine, usually through the reset register ACPI describes or a chipset port. Whatever is in RAM is treated as lost: the CPU starts over from the beginning.",
      code: [{ project: "linux", path: "arch/x86/kernel/reboot.c", symbol: "native_machine_restart" }],
      timescale: "ms",
      learns: FORGOTTEN,
      ui: { screen: "off" },
    });
  } else {
    steps.push(
      {
        id: "soft-off",
        phase: "power",
        path: ["acpi", "pmc"],
        frames: [dataFrame(1, "Register write", "Soft off (S5)", pm1Control)],
        title: "ACPI: soft off",
        body: "Last, the ACPI code writes the sleep type for S5, soft off, which it read from the firmware's ACPI tables, together with the sleep-enable bit into the chipset's PM1 control register.",
        code: [
          { project: "linux", path: "drivers/acpi/sleep.c", symbol: "acpi_power_off" },
          { project: "linux", path: "drivers/acpi/acpica/hwsleep.c", symbol: "acpi_hw_legacy_sleep" },
        ],
        timescale: "ms",
        data: {
          amount: "2 bytes",
          what: "one write to the 16-bit PM1 control register: the S5 sleep type in bits 10 to 12 and the sleep-enable bit, 13",
        },
        aws: {
          service: "Amazon EC2",
          text: "StopInstances begins like a press of this power button: EC2 sends the instance an ACPI shutdown event, and the operating system runs the same sequence down to soft off.",
        },
      },
      {
        id: "power-off",
        phase: "power",
        path: ["pmc"],
        title: "Power off",
        body: "The chipset switches the power supply's main outputs off. RAM forgets everything: the page cache, the neighbour table, every process. Only standby power remains, enough to notice the power button.",
        learns: FORGOTTEN,
        aws: {
          service: "Amazon EC2 instance store",
          text: "A stopped EC2 instance forgets the same way, and more: data on its instance store volumes is lost, because those disks belong to the host it leaves. EBS volumes keep their data.",
        },
        ui: { screen: "off" },
      },
    );
  }
  return steps;
}

export function shutdown(): Scenario {
  return { kind: "shutdown", app: null, title: "Shutting down", focus: "split", steps: shutdownSteps(false) };
}

export function restart(): Scenario {
  return {
    kind: "restart",
    app: null,
    title: "Restarting",
    focus: "split",
    steps: [...shutdownSteps(true), ...bootSteps()],
  };
}
