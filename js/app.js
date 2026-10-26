/* =========================================
   TOOLS TOKO
   APP.JS
========================================= */

/* =========================================
   ELEMENT
========================================= */

const menuToggle =
    document.getElementById("menuToggle");

const sidebar =
    document.getElementById("sidebar");

const sidebarOverlay =
    document.getElementById("sidebarOverlay");

const navItems =
    document.querySelectorAll(".nav-item");

const pages =
    document.querySelectorAll(".page");

const mainContent = document.getElementById("mainContent");

const pageFragments = new Set([
    "home",
    "stok-toko",
    "stok-gudang",
    "gudang",
    "toko",
    "data-expired",
    "admin",
    "laporan",
    "cek-harga",
    "cek-stok",
    "developer"
]);
const loadedPageFragments = new Set();
const pageLoadPromises = new Map();

// CSS halaman dinamis dimuat sebelum fragmen HTML ditampilkan.
// Setiap halaman stok memiliki stylesheet mandiri dan tidak berbagi file CSS.
const pageStylesheets = new Map([
    ["stok-toko", "css/pages/stok-toko.css?v=17"],
    ["stok-gudang", "css/pages/stok-gudang.css?v=17"],
    ["data-expired", "css/pages/expired.css?v=22"],
    ["developer", "css/pages/developer.css?v=15"]
]);
const pageStylesheetPromises = new Map();

function loadPageStylesheet(pageName) {
    const stylesheetPath = pageStylesheets.get(pageName);
    if (!stylesheetPath) return Promise.resolve();
    // Kunci berdasarkan path agar CSS bersama tidak dimuat dua kali untuk dua halaman.
    if (pageStylesheetPromises.has(stylesheetPath)) {
        return pageStylesheetPromises.get(stylesheetPath);
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = stylesheetPath;
    link.dataset.pageStylesheet = pageName;

    const promise = new Promise(resolve => {
        link.addEventListener("load", resolve, { once: true });
        link.addEventListener("error", () => {
            link.remove();
            pageStylesheetPromises.delete(stylesheetPath);
            console.error("Gagal memuat CSS halaman " + pageName + ": " + stylesheetPath);
            // Kegagalan CSS tidak boleh menggagalkan pemuatan HTML halaman.
            resolve();
        }, { once: true });
        document.head.appendChild(link);
    });

    pageStylesheetPromises.set(stylesheetPath, promise);
    return promise;
}

async function loadPageFragment(pageName) {
    if (!pageFragments.has(pageName)) return;
    const page = document.getElementById("page-" + pageName);
    if (!page || loadedPageFragments.has(pageName)) return;
    if (pageLoadPromises.has(pageName)) return pageLoadPromises.get(pageName);

    const fragmentPath = pageName === "data-expired"
        ? "pages/data-expired.html?v=22"
        : "pages/" + pageName + ".html";
    const promise = fetch(fragmentPath)
        .then(response => {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.text();
        })
        .then(async markup => {
            // Muat CSS khusus sebelum memasukkan markup agar tidak sempat
            // tampil tanpa gaya.
            await loadPageStylesheet(pageName);
            page.innerHTML = markup;
            loadedPageFragments.add(pageName);
            page.setAttribute("aria-busy", "false");
        })
        .catch(error => {
            page.innerHTML =
                '<div class="page-load-error">' +
                'Konten menu gagal dimuat. Periksa folder pages ' +
                'lalu buka aplikasi melalui Acode Preview/server.' +
                '</div>';
            page.setAttribute("aria-busy", "false");
            pageLoadPromises.delete(pageName);
            console.error("Gagal memuat halaman " + pageName + ":", error);
            throw error;
        });
    page.setAttribute("aria-busy", "true");
    pageLoadPromises.set(pageName, promise);
    return promise;
}

/* =========================================
   SUBMENU MASTER DATA
========================================= */

const masterDataGroup =
    document.getElementById("masterDataGroup");

const masterDataToggle =
    document.getElementById("masterDataToggle");

/* =========================================
   SUBMENU LAPORAN
========================================= */

const laporanGroup =
    document.getElementById("laporanGroup");

const laporanToggle =
    document.getElementById("laporanToggle");

/* Sinkronkan status submenu dan atribut aksesibilitasnya. */
function setSubmenuState(group, toggle, isOpen) {
    if (group) {
        group.classList.toggle("open", isOpen);
    }

    if (toggle) {
        toggle.setAttribute("aria-expanded", String(isOpen));
    }
}

if (masterDataToggle && masterDataGroup) {
    masterDataToggle.addEventListener("click", function () {
        const isOpen = !masterDataGroup.classList.contains("open");

        // Hanya satu kelompok submenu yang boleh terbuka pada satu waktu.
        setSubmenuState(laporanGroup, laporanToggle, false);
        setSubmenuState(masterDataGroup, masterDataToggle, isOpen);
    });
}

if (laporanToggle && laporanGroup) {
    laporanToggle.addEventListener("click", function () {
        const isOpen = !laporanGroup.classList.contains("open");

        // Hanya satu kelompok submenu yang boleh terbuka pada satu waktu.
        setSubmenuState(masterDataGroup, masterDataToggle, false);
        setSubmenuState(laporanGroup, laporanToggle, isOpen);
    });
}

/* =========================================
   SIDEBAR HP
========================================= */

function toggleSidebar() {

    sidebar.classList.toggle("open");

    sidebarOverlay.classList.toggle("show");

}

function closeSidebar() {

    sidebar.classList.remove("open");

    sidebarOverlay.classList.remove("show");

}

/* =========================================
   GESTURE SWIPE SIDEBAR HP
========================================= */

let touchStartX = 0;
let touchEndX = 0;

// Menandai apakah gesture berasal dari area yang boleh
// digunakan untuk membuka/menutup sidebar.
let allowSidebarSwipe = true;

// Geser horizontal pada tabel harus tetap digunakan untuk menggulir tabel,
// bukan dianggap sebagai gesture untuk membuka atau menutup sidebar.
const sidebarSwipeExcludedAreas =
    ".product-table-wrapper, .stock-table-scroll, .expired-table-wrapper";

document.addEventListener("touchstart", function(event) {

    if (window.innerWidth > 700) {
        return;
    }

    // Jangan mengambil alih gesture gulir horizontal pada tabel.
    if (event.target.closest(sidebarSwipeExcludedAreas)) {
        allowSidebarSwipe = false;
        return;
    }

    allowSidebarSwipe = true;

    touchStartX =
        event.changedTouches[0].screenX;

});

document.addEventListener("touchend", function(event) {

    if (window.innerWidth > 700) {
        return;
    }

    // Jika gesture dimulai dari area tabel, jangan diproses sebagai gesture sidebar.
    if (!allowSidebarSwipe) {
        return;
    }

    touchEndX =
        event.changedTouches[0].screenX;

    handleSwipe();

});

function handleSwipe() {

    const swipeDistance =
        touchEndX - touchStartX;

    /* Usap kanan */

    if (
        swipeDistance > 70 &&
        !sidebar.classList.contains("open")
    ) {

        toggleSidebar();

    }

    /* Usap kiri */

    if (
        swipeDistance < -70 &&
        sidebar.classList.contains("open")
    ) {

        closeSidebar();

    }

}

menuToggle.addEventListener(
    "click",
    toggleSidebar
);

sidebarOverlay.addEventListener(
    "click",
    closeSidebar
);

/* =========================================
   TAMPILKAN HALAMAN
========================================= */

async function showPage(pageName) {

    // Pastikan CSS halaman siap sebelum halaman diaktifkan agar tidak tampil tanpa gaya.
    if (pageStylesheets.has(pageName)) {
        await loadPageStylesheet(pageName);
    }

    pages.forEach(function(page) {
        page.classList.remove("active");
    });

    const targetPage = document.getElementById("page-" + pageName);
    if (targetPage) {
        targetPage.classList.add("active");
    }

    try {
        await loadPageFragment(pageName);
    } catch (_) {
        // The page displays its own loading error; keep navigation responsive.
    }

    if (pageName === "master-data" && typeof initMasterProduk === "function") {
        initMasterProduk();
    }

    // Data Expired is initialized only after its HTML fragment has been inserted.
    if (pageName === "data-expired" && typeof window.initExpiredPage === "function") {
        await window.initExpiredPage();
    }

    if (pageName === "stok-toko" && typeof window.initStokTokoPage === "function") {
        window.initStokTokoPage();
    }

    if (pageName === "stok-gudang" && typeof window.initStokGudangPage === "function") {
        window.initStokGudangPage();
    }

    // Developer form elements exist only after their HTML fragment has loaded.
    if (pageName === "developer" && typeof window.initDeveloperPage === "function") {
        window.initDeveloperPage();
    }

    const isMasterDataPage = [
        "master-data",
        "stok-toko",
        "stok-gudang"
    ].includes(pageName);
    const isLaporanPage = ["laporan", "data-expired"].includes(pageName);
    setSubmenuState(masterDataGroup, masterDataToggle, isMasterDataPage);
    setSubmenuState(laporanGroup, laporanToggle, isLaporanPage);

    if (masterDataToggle) masterDataToggle.classList.toggle("active", isMasterDataPage);
    if (laporanToggle) laporanToggle.classList.toggle("active", isLaporanPage);

    navItems.forEach(function(item) {
        item.classList.toggle("active", item.dataset.page === pageName);
    });

    if (window.innerWidth <= 700) closeSidebar();
}

/* =========================================
   KLIK MENU UTAMA
========================================= */

navItems.forEach(function(item) {

    item.addEventListener(
        "click",
        function(event) {

            event.preventDefault();

            const pageName =
                this.dataset.page;

            showPage(pageName);

            /* Ubah URL tanpa reload */

            history.pushState(
                null,
                "",
                "#" + pageName
            );

        }
    );

});

/* =========================================
   FAST MENU (delegated because Home is loaded on demand)
========================================= */

if (mainContent) {
    mainContent.addEventListener("click", function(event) {
        const card = event.target.closest(".fast-card[data-page]");
        if (!card) return;
        const pageName = card.dataset.page;
        showPage(pageName);
        history.pushState(null, "", "#" + pageName);
    });
}

/* =========================================
   HALAMAN SAAT APLIKASI DIBUKA
========================================= */

function loadInitialPage() {

    const hash =
        window.location.hash.replace(
            "#",
            ""
        );

    if (hash) {

        const targetPage =
            document.getElementById(
                "page-" + hash
            );

        if (targetPage) {

            showPage(hash);

            return;

        }

    }

    /* Default = Home */

    showPage("home");

}

/*
   Jalankan setelah semua script pada index.html selesai dimuat.
   Ini penting untuk tautan langsung ke Master Produk atau halaman Stok,
   karena fungsi inisialisasinya didefinisikan pada file JS berikutnya.
*/
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadInitialPage, { once: true });
} else {
    loadInitialPage();
}

/* =========================================
   BROWSER BACK / FORWARD
========================================= */

window.addEventListener(
    "popstate",
    function() {

        loadInitialPage();

    }
);

/* =========================================
   SETTING APLIKASI
========================================= */

const SETTINGS_KEY = "toolsTokoSettings";

/* Default setting */

const defaultSettings = {
    initialized: true,

    cabang: {
        id: "",
        nama: ""
    },

    user: {
        id: "",
        nama: "",
        username: "",
        role: "",
        status: "aktif"
    }
};

/* Buat salinan default agar objek cabang/user tidak berbagi referensi. */
function createDefaultSettings() {
    return {
        ...defaultSettings,
        cabang: { ...defaultSettings.cabang },
        user: { ...defaultSettings.user }
    };
}

/* Ambil setting sekaligus pulihkan struktur jika data tersimpan tidak valid. */
function getSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);

    if (saved) {
        try {
            const parsed = JSON.parse(saved);

            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                const cabang = parsed.cabang &&
                    typeof parsed.cabang === "object" &&
                    !Array.isArray(parsed.cabang)
                    ? parsed.cabang
                    : {};

                const user = parsed.user &&
                    typeof parsed.user === "object" &&
                    !Array.isArray(parsed.user)
                    ? parsed.user
                    : {};

                return {
                    ...defaultSettings,
                    ...parsed,
                    cabang: { ...defaultSettings.cabang, ...cabang },
                    user: { ...defaultSettings.user, ...user }
                };
            }

            console.warn("Format pengaturan tidak valid, menggunakan default.");
        } catch (error) {
            console.warn("Setting rusak, menggunakan default.");
        }
    }

    const settings = createDefaultSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
}

/* Simpan setting */

function saveSettings(settings) {

    localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(settings)
    );

}

/* =========================================
   DATA CABANG AKTIF
========================================= */

function getCabangAktif() {

    const settings = getSettings();

    return settings.cabang || {
        id: "",
        nama: ""
    };

}

function setCabangAktif(id, nama) {

    const settings = getSettings();

    settings.cabang = {
        id: id,
        nama: nama
    };

    saveSettings(settings);

}

function clearCabangAktif() {

    const settings = getSettings();

    settings.cabang = {
        id: "",
        nama: ""
    };

    saveSettings(settings);

}

/* =========================================
   USER AKTIF
========================================= */

function getUserAktif() {

    const settings = getSettings();

    return settings.user || {
        id: "",
        nama: "",
        username: "",
        role: "",
        status: "aktif"
    };

}

function setUserAktif(
    id,
    nama,
    username,
    role
) {

    const settings = getSettings();

    settings.user = {
        id: id,
        nama: nama,
        username: username,
        role: role,
        status: "aktif"
    };

    saveSettings(settings);

}

function clearUserAktif() {

    const settings = getSettings();

    settings.user = {
        id: "",
        nama: "",
        username: "",
        role: "",
        status: "aktif"
    };

    saveSettings(settings);

}

/* =========================================
   ROLE USER
========================================= */

const availableRoles = [
    "developer",
    "admin",
    "gudang",
    "toko"
];

/* =========================================
   HAK AKSES
========================================= */

const accessPermissions = {

    developer: [
        "home",
        "master-data",
        "gudang",
        "toko",
        "laporan",
        "admin",
        "developer"
    ],

    admin: [
        "home",
        "master-data",
        "admin"
    ],

    gudang: [
        "home",
        "master-data",
        "gudang"
    ],

    toko: [
        "home",
        "master-data",
        "toko"
    ]

};

/* =========================================
   CEK HAK AKSES
========================================= */

function hasAccess(pageName) {

    const user =
        getUserAktif();

    const role =
        user.role;

    if (!role) {
        return false;
    }

    const permissions =
        accessPermissions[role];

    if (!permissions) {
        return false;
    }

    return permissions.includes(pageName);
}

/* Inisialisasi */

getSettings();
