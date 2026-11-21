
/* =====================================
   FIND IT - USIU AFRICA LOST AND FOUND
   CAMPUS LOST AND FOUND
===================================== */

const STORE_KEY = "findItUSIU_v1";
const API_ROOT = "";

// =====================================
// APPLICATION DATA
// =====================================

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY));

        return {
            items: [],
            claims: [],
            lostReports: saved && Array.isArray(saved.lostReports)
                ? saved.lostReports
                : []
        };
    } catch {
        return {
            items: [],
            claims: [],
            lostReports: []
        };
    }
}

let state = loadState();

let currentUser = JSON.parse(
    sessionStorage.getItem("findItUser") || "null"
);

let selectedCategory = "All";
let pendingPhoto = "";
let toastTimer;


// Save application data
function saveState() {
    localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ lostReports: state.lostReports })
    );
}


function getCookie(name) {
    const cookie = document.cookie
        .split(";")
        .map(value => value.trim())
        .find(value => value.startsWith(name + "="));

    return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}


async function refreshSecuritySession() {
    const response = await fetch("/security/session/", {
        headers: { Accept: "application/json" }
    });
    if (!response.ok) {
        throw new Error("Could not verify the security session.");
    }

    const session = await response.json();
    if (session.authenticated) {
        currentUser = {
            name: session.name,
            email: session.email,
            role: "security"
        };
        sessionStorage.setItem("findItUser", JSON.stringify(currentUser));
    } else if (currentUser && currentUser.role === "security") {
        currentUser = null;
        sessionStorage.removeItem("findItUser");
    }

    updateUser();
    renderSecurity();
}


async function syncFoundItems() {
    const results = [];
    let page = 1;
    let pages = 1;

    do {
        const response = await fetch(`${API_ROOT}/found/?page=${page}`, {
            headers: { Accept: "application/json" }
        });

        if (!response.ok) {
            throw new Error("Could not load found items.");
        }

        const payload = await response.json();
        results.push(...payload.results);
        pages = payload.pages;
        page += 1;
    } while (page <= pages);

    state.items = results.map(item => ({
        id: String(item.id),
        name: item.item_name,
        category: item.category || "Other",
        location: item.location_found,
        date: item.date_found,
        description: item.description,
        photo: item.photo,
        status: item.status === "returned" ? "Returned" : "Found",
        questions: [item.security_question],
        answers: [],
        claims: []
    }));

    renderHome();
    renderBrowse();
}


// Prevent HTML injection when displaying user-provided text
function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}


// Notification message
function showToast(message) {
    const toast = document.getElementById("toast");

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}


// =====================================
// PAGE NAVIGATION
// =====================================

function go(page) {

    document.querySelectorAll(".page").forEach(p => {
        p.classList.remove("active");
    });

    const target = document.getElementById(page + "Page");

    if (target) {
        target.classList.add("active");
    }

    document.querySelectorAll(".nav-link").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === page
        );
    });

    document.getElementById("mainNav").classList.remove("open");

    if (page === "browse") renderBrowse();
    if (page === "home") renderHome();
    if (page === "security") {
        renderSecurity();
        if (currentUser && currentUser.role === "security") {
            syncSecurityClaims().catch(() => {
                showToast("Could not load security claims.");
            });
        }
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


// Handle navigation buttons
document.addEventListener("click", event => {

    const button = event.target.closest("[data-page]");

    if (button) {
        event.preventDefault();
        go(button.dataset.page);
    }

});


// Mobile menu
document.getElementById("menuToggle").addEventListener(
    "click",
    () => {
        document.getElementById("mainNav").classList.toggle("open");
    }
);


// =====================================
// STUDENT LOGIN
// =====================================

document.getElementById("accountButton").addEventListener(
    "click",
    () => {
        document.getElementById("accountDialog").showModal();
    }
);


function updateUser() {

    const label = document.getElementById("userLabel");

    label.textContent = currentUser
        ? currentUser.role === "security"
            ? "Security"
            : currentUser.name
        : "Guest";

    document.getElementById("accountButton").textContent =
        currentUser ? "Account" : "Student portal";
}


// Student login
document.getElementById("studentLoginForm").addEventListener(
    "submit",
    event => {

        event.preventDefault();

        const formData = new FormData(event.target);

        currentUser = {
            name: formData.get("name").trim(),
            email: formData.get("email").trim(),
            role: "student"
        };

        sessionStorage.setItem(
            "findItUser",
            JSON.stringify(currentUser)
        );

        updateUser();

        document.getElementById("accountDialog").close();

        showToast("Student session started.");
    }
);


document.getElementById("securityLoginForm").addEventListener(
    "submit",
    async event => {
        event.preventDefault();

        const formData = new FormData(event.target);
        let response;
        try {
            response = await fetch("/security/login/", {
                method: "POST",
                headers: { "X-CSRFToken": getCookie("csrftoken") },
                body: formData
            });
        } catch {
            showToast("Could not connect to the security sign-in service.");
            return;
        }

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showToast(result.error || "Security sign-in failed.");
            return;
        }

        currentUser = {
            name: result.name,
            email: result.email,
            role: "security"
        };
        sessionStorage.setItem("findItUser", JSON.stringify(currentUser));
        event.target.reset();
        updateUser();
        document.getElementById("accountDialog").close();
        go("security");
        showToast("Security signed in.");
    }
);


document.getElementById("securityLogin").addEventListener(
    "click",
    () => {
        document.getElementById("accountDialog").showModal();
    }
);


// Logout
document.getElementById("logoutButton").addEventListener(
    "click",
    async () => {
        let response;
        try {
            response = await fetch("/security/logout/", {
                method: "POST",
                headers: { "X-CSRFToken": getCookie("csrftoken") }
            });
        } catch {
            showToast("Could not connect to the sign-out service.");
            return;
        }
        if (!response.ok) {
            showToast("Could not sign out.");
            return;
        }
        currentUser = null;
        sessionStorage.removeItem("findItUser");
        updateUser();
        document.getElementById("accountDialog").close();
        showToast("You have signed out.");
    }
);


// =====================================
// DISPLAY FOUND ITEMS
// =====================================

function itemCard(item) {

    const photo = item.photo
        ? `<img src="${item.photo}" alt="${escapeHTML(item.name)}">`
        : `<span class="photo-placeholder">▧</span>`;

    return `
        <article class="item-card">

            <div class="item-photo">
                ${photo}
            </div>

            <div class="item-card-body">

                <h3>${escapeHTML(item.name)}</h3>

                <p class="item-meta">
                    ${escapeHTML(item.location)}
                    <br>
                    ${escapeHTML(item.date || "Date not provided")}
                </p>

                <span class="status-pill">
                    ${escapeHTML(item.status || "Found")}
                </span>

                <button
                    class="text-button claim-link"
                    data-claim="${escapeHTML(item.id)}"
                >
                    View details / claim →
                </button>

            </div>

        </article>
    `;
}


// Home page items
function renderHome() {

    const items = state.items.filter(
        item => item.status !== "Returned"
    );

    document.getElementById("homeItems").innerHTML =
        items.slice(0, 3).map(itemCard).join("") ||
        "<p>No items listed yet.</p>";
}


// Browse page
function renderBrowse() {

    const query = (
        document.getElementById("searchInput").value || ""
    ).toLowerCase();

    const items = state.items.filter(item => {

        return item.status !== "Returned" &&
            (
                selectedCategory === "All" ||
                item.category === selectedCategory
            ) &&
            [
                item.name,
                item.description,
                item.location,
                item.category
            ].join(" ").toLowerCase().includes(query);

    });

    document.getElementById("browseItems").innerHTML =
        items.map(itemCard).join("");

    document.getElementById("itemCount").textContent =
        `Showing ${items.length} item(s)`;

    document.getElementById("emptyItems").classList.toggle(
        "hidden",
        items.length !== 0
    );
}


// Search
document.getElementById("searchButton").addEventListener(
    "click",
    renderBrowse
);

document.getElementById("searchInput").addEventListener(
    "input",
    renderBrowse
);


// Category filtering
document.getElementById("categoryFilters").addEventListener(
    "click",
    event => {

        const button = event.target.closest("[data-category]");

        if (!button) return;

        selectedCategory = button.dataset.category;

        document.querySelectorAll(".filter").forEach(filter => {
            filter.classList.toggle("active", filter === button);
        });

        renderBrowse();
    }
);


// Claim buttons
document.getElementById("browseItems").addEventListener(
    "click",
    event => {

        const button = event.target.closest("[data-claim]");

        if (button) {
            openClaim(button.dataset.claim);
        }
    }
);

document.getElementById("homeItems").addEventListener(
    "click",
    event => {

        const button = event.target.closest("[data-claim]");

        if (button) {
            openClaim(button.dataset.claim);
        }
    }
);


// =====================================
// OWNERSHIP VERIFICATION QUIZ
// =====================================

function openClaim(id) {

    const item = state.items.find(
        item => item.id === id
    );

    if (!item) return;

    if (item.status === "Returned") {
        showToast("This item has already been returned.");
        return;
    }

    if (!currentUser || currentUser.role !== "student") {

        showToast("Please sign in as a student first.");

        document.getElementById("accountDialog").showModal();

        return;
    }

    const questions = (item.questions || []).filter(Boolean);

    const image = item.photo
        ? `<img src="${item.photo}" alt="">`
        : `<div class="photo-placeholder">▧</div>`;

    document.getElementById("claimContent").innerHTML = `

        <div class="claim-item-heading">

            ${image}

            <div>
                <h2>Claim an item</h2>

                <strong>${escapeHTML(item.name)}</strong>

                <div class="muted">
                    ${escapeHTML(item.location)}
                </div>
            </div>

        </div>

        <p class="muted">
            Answer the private ownership question. A correct answer confirms your claim;
            collect the item from campus security.
        </p>

        <form id="claimForm">

            ${questions.map((question, index) => `

                <div class="quiz-question">

                    <label>
                        ${index + 1}. ${escapeHTML(question)}

                        <input
                            name="answer${index}"
                            required
                            autocomplete="off"
                            placeholder="Your answer"
                        >

                    </label>

                </div>

            `).join("")}

            <label class="form-note">
                <input type="checkbox" name="confirm" required>
                I confirm that my information is accurate.
            </label>

            <button class="btn btn-primary full-width" type="submit">
                Submit ownership claim
            </button>

        </form>
    `;

    document.getElementById("claimDialog").showModal();


    // Submit quiz
    document.getElementById("claimForm").addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            const formData = new FormData(event.target);

            const answers = questions.map((question, index) => {

                return String(
                    formData.get("answer" + index) || ""
                ).trim();

            });

            const verificationData = new FormData();
            verificationData.append("answer", answers[0]);
            verificationData.append("claimant_name", currentUser.name);
            verificationData.append("claimant_email", currentUser.email);

            let verification;

            try {
                verification = await fetch(
                    `${API_ROOT}/found/${encodeURIComponent(item.id)}/claim/`,
                    {
                        method: "POST",
                        headers: { "X-CSRFToken": getCookie("csrftoken") },
                        body: verificationData
                    }
                );
            } catch {
                showToast("Could not connect to the verification service.");
                return;
            }

            if (!verification.ok) {
                const result = await verification.json().catch(() => ({}));
                showToast(result.error || "The answer did not match.");
                return;
            }

            document.getElementById("claimDialog").close();

            const result = await verification.json();
            showToast(result.message || "Claim submitted to Security for review.");
        }
    );
}


// =====================================
// SECURITY: ADD FOUND ITEMS
// =====================================

document.getElementById("foundItemForm").addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        if (!currentUser || currentUser.role !== "security") {

            showToast("Security access is required.");

            return;
        }

        const formData = new FormData(event.target);

        const photo = event.target.elements.photo.files[0];
        const itemData = new FormData();
        itemData.append("item_name", formData.get("name").trim());
        itemData.append("category", formData.get("category"));
        itemData.append("description", formData.get("description").trim());
        itemData.append("photo", photo);
        itemData.append("location_found", formData.get("location").trim());
        itemData.append("date_found", formData.get("date"));
        itemData.append("finder_name", currentUser.name);
        itemData.append("finder_contact", currentUser.email);
        itemData.append("security_question", formData.get("q1").trim());
        itemData.append("security_answer", formData.get("a1").trim());

        try {
            const response = await fetch(`${API_ROOT}/found/`, {
                method: "POST",
                headers: { "X-CSRFToken": getCookie("csrftoken") },
                body: itemData
            });

            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                const errors = Object.values(result.errors || {})
                    .flat()
                    .map(error => error.message)
                    .filter(Boolean);
                showToast(errors[0] || "Could not publish the found item.");
                return;
            }

            event.target.reset();
            pendingPhoto = "";
            document.getElementById("photoPreview").textContent =
                "Photo preview will appear here";
            await syncFoundItems();
            showToast("Found item published successfully.");
        } catch {
            showToast("Could not connect to the found-items service.");
        }
    }
);


// =====================================
// UPLOAD ITEM PHOTOGRAPH
// =====================================

document.querySelector('input[name="photo"]').addEventListener(
    "change",
    event => {

        const file = event.target.files[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {

            showToast("Please choose an image file.");

            return;
        }

        if (file.size > 1.5 * 1024 * 1024) {

            showToast("Choose an image smaller than 1.5 MB.");

            event.target.value = "";

            return;
        }

        const reader = new FileReader();

        reader.onload = () => {

            pendingPhoto = reader.result;

            document.getElementById("photoPreview").innerHTML = `
                <img src="${pendingPhoto}" alt="Selected item preview">
            `;

        };

        reader.readAsDataURL(file);
    }
);


// =====================================
// STUDENT LOST ITEM REPORT
// =====================================

document.getElementById("lostReportForm").addEventListener(
    "submit",
    event => {

        event.preventDefault();

        const formData = new FormData(event.target);

        const report = {

            id: "l" + Date.now(),

            name: formData.get("name"),

            email: formData.get("email"),

            item: formData.get("item"),

            category: formData.get("category"),

            lastSeen: formData.get("lastSeen"),

            description: formData.get("description"),

            submitted: new Date().toISOString()
        };

        state.lostReports.push(report);

        saveState();

        event.target.reset();

        showToast("Lost-item report submitted successfully.");
    }
);


// =====================================
// SECURITY DASHBOARD
// =====================================

function renderSecurity() {

    const isSecurity =
        currentUser && currentUser.role === "security";

    document.getElementById("securityLocked").classList.toggle(
        "hidden",
        !!isSecurity
    );

    document.getElementById("securityContent").classList.toggle(
        "hidden",
        !isSecurity
    );

    if (!isSecurity) return;


    // Dashboard statistics
    document.getElementById("statItems").textContent =
        state.items.length;

    document.getElementById("statClaims").textContent =
        state.claims.filter(
            claim => claim.status === "pending"
        ).length;

    document.getElementById("statReturned").textContent =
        state.items.filter(
            item => item.status === "Returned"
        ).length;


    // Display submitted claims
    const list = document.getElementById("claimsList");

    list.innerHTML = state.claims.length
        ? state.claims.map(claim => `

            <div class="claim-row">

                <strong>${escapeHTML(claim.item_name)}</strong>

                <small>
                    ${escapeHTML(claim.claimant_name)}
                    •
                    ${escapeHTML(claim.claimant_email)}
                    <br>
                    ${new Date(claim.submitted_at).toLocaleString()}
                    •
                    ${escapeHTML(claim.status)}
                    ${claim.answer_verified ? "• Ownership answer verified" : ""}
                </small>

                ${
                    claim.status === "pending"
                    ? `
                        <div class="claim-actions">

                            <button
                                class="btn btn-primary"
                                data-approve="${claim.id}"
                            >
                                Approve & mark returned
                            </button>

                            <button
                                class="btn btn-outline"
                                data-reject="${claim.id}"
                            >
                                Decline
                            </button>

                        </div>
                    `
                    : ""
                }

            </div>

        `).join("")

        : "<p>No claims submitted yet.</p>";
}


async function syncSecurityClaims() {
    const response = await fetch("/security/claims/", {
        headers: { Accept: "application/json" }
    });
    if (!response.ok) {
        throw new Error("Could not load security claims.");
    }

    const payload = await response.json();
    state.claims = payload.results;
    renderSecurity();
}


// =====================================
// APPROVE AND DECLINE CLAIMS
// =====================================

document.getElementById("claimsList").addEventListener(
    "click",
    async event => {
        const approve = event.target.closest("[data-approve]");
        const reject = event.target.closest("[data-reject]");
        if (!approve && !reject) {
            return;
        }

        const claimId = (approve || reject).dataset.approve
            || (approve || reject).dataset.reject;
        const status = approve ? "approved" : "declined";
        const confirmation = approve
            ? "Confirm you verified the claimant's identity in person and are returning this item."
            : "Decline this ownership claim?";
        if (!window.confirm(confirmation)) return;

        const data = new FormData();
        data.append("status", status);

        let response;
        try {
            response = await fetch(
                `/security/claims/${encodeURIComponent(claimId)}/decision/`,
                {
                    method: "POST",
                    headers: { "X-CSRFToken": getCookie("csrftoken") },
                    body: data
                }
            );
        } catch {
            showToast("Could not connect to the claim review service.");
            return;
        }

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showToast(result.error || "Could not update this claim.");
            return;
        }

        try {
            await syncFoundItems();
            await syncSecurityClaims();
            showToast(status === "approved" ? "Item marked as returned." : "Claim declined.");
        } catch {
            showToast("Claim updated, but the dashboard could not be refreshed.");
        }
    }
);


// =====================================
// START APPLICATION
// =====================================

updateUser();

renderHome();

renderBrowse();

renderSecurity();

syncFoundItems().catch(() => {
    showToast("Could not load found items from the database.");
});

refreshSecuritySession().catch(() => {
    showToast("Could not verify the security session.");
});
