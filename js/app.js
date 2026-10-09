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

const fastCards =
    document.querySelectorAll(".fast-card");


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
// digunakan untuk membuka/menutup sidebar
let allowSidebarSwipe = true;


document.addEventListener("touchstart", function(event) {

    if (window.innerWidth > 700) {
        return;
    }

    // Jika menyentuh area tabel, jangan gunakan gesture sidebar
    if (event.target.closest(".product-table-wrapper")) {
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

    // Jika gesture dimulai dari area tabel,
    // jangan diproses sebagai gesture sidebar
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

function showPage(pageName) {

    pages.forEach(function(page) {

        page.classList.remove("active");

    });


    const targetPage =
        document.getElementById(
            "page-" + pageName
        );


    if (targetPage) {

        targetPage.classList.add("active");

    }

    if (
        pageName === "master-data" &&
    typeof initMasterProduk === "function"
  ) {

    initMasterProduk();

  }


    /* Update menu aktif */

    navItems.forEach(function(item) {

        item.classList.remove("active");

        if (
            item.dataset.page === pageName
        ) {

            item.classList.add("active");

        }

    });


    /* Tutup menu HP */

    if (window.innerWidth <= 700) {

        closeSidebar();

    }

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
   FAST MENU
========================================= */

fastCards.forEach(function(card) {

    card.addEventListener(
        "click",
        function() {

            const pageName =
                this.dataset.page;

            showPage(pageName);

            history.pushState(
                null,
                "",
                "#" + pageName
            );

        }
    );

});


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


/* Jalankan */

loadInitialPage();


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

/* Ambil setting */

function getSettings() {

    const saved =
        localStorage.getItem(SETTINGS_KEY);

    if (saved) {

        try {

            return JSON.parse(saved);

        } catch (error) {

            console.warn(
                "Setting rusak, menggunakan default."
            );

        }

    }

    localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(defaultSettings)
    );

    return {
        ...defaultSettings
    };
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


/* Reset setting */

function resetSettings() {

    const yakin =
        confirm(
            "Yakin ingin mereset semua pengaturan aplikasi?"
        );

    if (!yakin) {
        return;
    }

    localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(defaultSettings)
    );

    alert(
        "Pengaturan berhasil direset."
    );

}


/* Tombol Reset */

const resetSettingsButton =
    document.getElementById("resetSettings");


if (resetSettingsButton) {

    resetSettingsButton.addEventListener(
        "click",
        resetSettings
    );

}


/* Inisialisasi */

getSettings();

/* =========================================
   FORM CABANG
========================================= */

const branchIdInput =
    document.getElementById("branchId");

const branchNameInput =
    document.getElementById("branchName");

const saveBranchButton =
    document.getElementById("saveBranch");


/* Tampilkan cabang yang tersimpan */

function loadBranchSetting() {

    const cabang =
        getCabangAktif();

    if (branchIdInput) {
        branchIdInput.value =
            cabang.id || "";
    }

    if (branchNameInput) {
        branchNameInput.value =
            cabang.nama || "";
    }

}


/* Simpan cabang */

if (saveBranchButton) {

    saveBranchButton.addEventListener(
        "click",
        function() {

            const id =
                branchIdInput.value.trim();

            const nama =
                branchNameInput.value.trim();


            if (!id || !nama) {

                alert(
                    "ID Cabang dan Nama Cabang harus diisi."
                );

                return;
            }


            setCabangAktif(
                id,
                nama
            );


            alert(
                "Data cabang berhasil disimpan."
            );

        }
    );

}


/* Load saat aplikasi dibuka */

loadBranchSetting();