/* =========================================
   TOOLS TOKO — DEVELOPER
   Pengaturan cabang dan reset pengaturan
========================================= */

(function () {
    "use strict";

    function loadBranchSetting(page) {
        const branchIdInput = page.querySelector("#branchId");
        const branchNameInput = page.querySelector("#branchName");
        const cabang = getCabangAktif();

        if (branchIdInput) branchIdInput.value = cabang.id || "";
        if (branchNameInput) branchNameInput.value = cabang.nama || "";
    }

    function resetSettings(page) {
        const yakin = confirm("Yakin ingin mereset semua pengaturan aplikasi?");
        if (!yakin) return;

        saveSettings(createDefaultSettings());
        loadBranchSetting(page);
        alert("Pengaturan berhasil direset.");
    }

    function bindOnce(element, eventName, handler, marker) {
        if (!element || element.dataset[marker] === "true") return;
        element.dataset[marker] = "true";
        element.addEventListener(eventName, handler);
    }

    window.initDeveloperPage = function initDeveloperPage() {
        const page = document.getElementById("page-developer");
        if (!page) return;

        const branchIdInput = page.querySelector("#branchId");
        const branchNameInput = page.querySelector("#branchName");
        const saveBranchButton = page.querySelector("#saveBranch");
        const resetSettingsButton = page.querySelector("#resetSettings");

        loadBranchSetting(page);

        bindOnce(saveBranchButton, "click", function () {
            const id = branchIdInput ? branchIdInput.value.trim() : "";
            const nama = branchNameInput ? branchNameInput.value.trim() : "";

            if (!id || !nama) {
                alert("ID Cabang dan Nama Cabang harus diisi.");
                return;
            }

            setCabangAktif(id, nama);
            alert("Data cabang berhasil disimpan.");
        }, "branchHandlerBound");

        bindOnce(resetSettingsButton, "click", function () {
            resetSettings(page);
        }, "resetHandlerBound");
    };
})();
