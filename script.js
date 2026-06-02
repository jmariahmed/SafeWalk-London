document.addEventListener("DOMContentLoaded", () => {
    const GEOAPIFY_KEY = "c164052217124b6b8b862a085cc22ea1";
    const CRIME_REFRESH_MS = 5 * 60 * 1000;
    const preferredCountries = new Set(["gb", "ie"]);

    let currentLat = null;
    let currentLng = null;

    let baseRouteLine = null;
    let fallbackRouteLine = null;
    let routeOverlayGroup = null;
    let startRouteMarker = null;
    let endRouteMarker = null;
    let trackingMarker = null;
    let watchId = null;

    let selectedStartResult = null;
    let selectedDestinationResult = null;

    let lastCrimeRefresh = 0;
    let crimeChart = null;

    let summaryExpanded = true;
    let routeAnalysisInProgress = false;

    let routeCandidates = [];
    let activeRouteMode = "fastest";
    let fastestRouteCandidate = null;
    let safestRouteCandidate = null;
    let routeHasMeaningfulAlternative = false;

    const DEBUG_ROUTE_ALTERNATIVES = true;
    const pointSafetyCache = new Map();

    const map = L.map("map").setView([51.5072, -0.1276], 11);

    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
            attribution:
                "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
        }
    ).addTo(map);

    const scoreEl = document.querySelector(".score");
    const riskEl = document.querySelector(".risk");
    const insightEl = document.querySelector(".insight");
    const currentAreaEl = document.getElementById("currentArea");

    const locationBtn = document.getElementById("locationBtn");
    const shareBtn = document.getElementById("shareBtn");
    const emergencyBtn = document.getElementById("emergencyBtn");
    const routeBtn = document.getElementById("routeBtn");
    const trackingBtn = document.getElementById("trackingBtn");
    const crimeBtn = document.getElementById("crimeBtn");
    const closeCrimeDrawer = document.getElementById("closeCrimeDrawer");

    const summaryStrip = document.getElementById("summaryStrip");
    const summaryToggle = document.getElementById("summaryToggle");

    const startInput = document.getElementById("startLocation");
    const destinationInput = document.getElementById("destination");

    const currentAreaMini = document.getElementById("currentAreaMini");
    const safetyScoreMini = document.getElementById("safetyScoreMini");
    const riskMini = document.getElementById("riskMini");
    const incidentsMini = document.getElementById("incidentsMini");
    const distanceMini = document.getElementById("distanceMini");
    const timeMini = document.getElementById("timeMini");
    const tipMini = document.getElementById("tipMini");
    const routeSafety = document.getElementById("routeSafety");
    const routeSafetyText = document.getElementById("routeSafetyText");

    const alternativeRoute = document.getElementById("alternativeRoute");
    const alternativeRouteText = document.getElementById("alternativeRouteText");

    const routeStatus = document.getElementById("routeStatus");

    const crimeDrawer = document.getElementById("crimeDrawer");
    const crimeGrid = document.getElementById("crimeGrid");

    const routeCard = document.querySelector(".route-card");
    const journeyStatusEl = document.createElement("div");
    journeyStatusEl.style.marginTop = "4px";
    journeyStatusEl.style.padding = "12px 14px";
    journeyStatusEl.style.borderRadius = "16px";
    journeyStatusEl.style.background = "#f6f7f9";
    journeyStatusEl.style.color = "#111";
    journeyStatusEl.style.fontSize = "0.95rem";
    journeyStatusEl.style.lineHeight = "1.4";
    journeyStatusEl.textContent = "Plan a route, then tap Start Journey for live tracking.";
    routeCard.appendChild(journeyStatusEl);

    function setJourneyStatus(message) {
        journeyStatusEl.textContent = message;
    }

    function ensureDropdown(inputId, dropdownId) {
        let dropdown = document.getElementById(dropdownId);

        if (!dropdown) {
            const input = document.getElementById(inputId);
            dropdown = document.createElement("div");
            dropdown.id = dropdownId;
            dropdown.className = "autocomplete-dropdown";
            input.parentElement.appendChild(dropdown);
        }

        return dropdown;
    }

    const startDropdown = ensureDropdown("startLocation", "startDropdown");
    const destinationDropdown = ensureDropdown("destination", "destinationDropdown");

    const chartCtx = document.getElementById("crimeChart");
    crimeChart = new Chart(chartCtx, {
        type: "bar",
        data: {
            labels: ["Violence", "Robbery", "Theft", "Weapons", "Sexual Offences", "Other"],
            datasets: [{
                label: "Incidents",
                data: [0, 0, 0, 0, 0, 0]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });

    function clearDropdown(dropdown) {
        if (dropdown) {
            dropdown.innerHTML = "";
        }
    }

    function formatDistance(metres) {
        if (metres == null || Number.isNaN(metres)) return "—";
        if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
        return `${Math.round(metres)} m`;
    }

    function estimateWalkingTime(metres) {
        if (metres == null || Number.isNaN(metres)) return "—";

        const WALKING_SPEED_KMH = 4.8;
        const minutes = Math.max(1, Math.round((metres / 1000) / WALKING_SPEED_KMH * 60));

        if (minutes >= 60) {
            const hrs = Math.floor(minutes / 60);
            const rem = minutes % 60;
            return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
        }

        return `${minutes} min`;
    }

    function getRiskLabel(score) {
        if (score === null || score === undefined) {
            return { label: "⚪ Limited Data", color: "#64748b" };
        }
        if (score >= 75) return { label: "🟢 Low Risk", color: "#137f49" };
        if (score >= 50) return { label: "🟡 Moderate Risk", color: "#9a6b00" };
        return { label: "🔴 High Risk", color: "#b42318" };
    }

    function clearRouteVisuals(preserveMarkers = false) {
        if (baseRouteLine) {
            map.removeLayer(baseRouteLine);
            baseRouteLine = null;
        }

        if (fallbackRouteLine) {
            map.removeLayer(fallbackRouteLine);
            fallbackRouteLine = null;
        }

        if (routeOverlayGroup) {
            map.removeLayer(routeOverlayGroup);
            routeOverlayGroup = null;
        }

        if (!preserveMarkers) {
            if (startRouteMarker) {
                map.removeLayer(startRouteMarker);
                startRouteMarker = null;
            }

            if (endRouteMarker) {
                map.removeLayer(endRouteMarker);
                endRouteMarker = null;
            }
        }
    }

    function drawFallbackRoute(startLatLng, endLatLng) {
        if (fallbackRouteLine) {
            map.removeLayer(fallbackRouteLine);
        }

        fallbackRouteLine = L.polyline([startLatLng, endLatLng], {
            color: "#111111",
            opacity: 0.85,
            weight: 6,
            dashArray: "8, 8"
        }).addTo(map);

        map.fitBounds(fallbackRouteLine.getBounds().pad(0.25), {
            padding: [40, 40],
            maxZoom: 16
        });
    }

    function coordToLatLng(coord) {
        if (!coord) return null;

        if (Array.isArray(coord)) {
            return L.latLng(coord[0], coord[1]);
        }

        if (typeof coord.lat === "number" && typeof coord.lng === "number") {
            return L.latLng(coord.lat, coord.lng);
        }

        if (typeof coord.lat === "number" && typeof coord.lon === "number") {
            return L.latLng(coord.lat, coord.lon);
        }

        return null;
    }

    function getRouteColor(score) {
        if (score === null || score === undefined) return "#2563eb";
        if (score >= 75) return "#2563eb";
        if (score >= 50) return "#f59e0b";
        return "#dc2626";
    }

    function haversineKm(a, b) {
        const R = 6371;
        const lat1 = a[0] * Math.PI / 180;
        const lat2 = b[0] * Math.PI / 180;
        const dLat = (b[0] - a[0]) * Math.PI / 180;
        const dLng = (b[1] - a[1]) * Math.PI / 180;

        const sinLat = Math.sin(dLat / 2);
        const sinLng = Math.sin(dLng / 2);

        const h =
            sinLat * sinLat +
            Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function buildDetourWaypoint(startLatLng, destinationLatLng, side = 1) {
        const startLat = startLatLng[0];
        const startLng = startLatLng[1];
        const endLat = destinationLatLng[0];
        const endLng = destinationLatLng[1];

        const midLat = (startLat + endLat) / 2;
        const midLng = (startLng + endLng) / 2;

        const dx = endLng - startLng;
        const dy = endLat - startLat;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;

        const perpX = -dy / len;
        const perpY = dx / len;

        const routeKm = haversineKm(startLatLng, destinationLatLng);
        const offsetKm = Math.min(6, Math.max(1.5, routeKm * 0.18));

        const offsetLat = (perpY * offsetKm) / 111;
        const offsetLng = (perpX * offsetKm) / (111 * Math.cos((midLat * Math.PI) / 180));

        return [midLat + (side * offsetLat), midLng + (side * offsetLng)];
    }

    function buildOsrmRouteUrl(points) {
        const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
        return `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;
    }

    async function fetchOsrmRoute(points) {
        try {
            const routeUrl = buildOsrmRouteUrl(points);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);

            const response = await fetch(routeUrl, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Routing service returned ${response.status}`);
            }

            const data = await response.json();
            return data.routes?.[0] || null;
        } catch (error) {
            console.log("fetchOsrmRoute error:", error);
            return null;
        }
    }

    async function fetchCrimeData(lat, lng) {
        try {
            const response = await fetch(
                `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`
            );

            if (!response.ok) {
                throw new Error(`Police API returned ${response.status}`);
            }

            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.log("fetchCrimeData error:", error);
            return [];
        }
    }

    function prettyCategory(category) {
        const mapNames = {
            "violent-crime": "Violence",
            "robbery": "Robbery",
            "theft-from-the-person": "Theft",
            "bicycle-theft": "Theft",
            "shoplifting": "Theft",
            "other-theft": "Theft",
            "burglary": "Burglary",
            "vehicle-crime": "Theft",
            "criminal-damage-arson": "Damage",
            "anti-social-behaviour": "Anti-social",
            "public-order": "Public order",
            "drugs": "Drugs",
            "possession-of-weapons": "Weapons",
            "sexual-offences": "Sexual Offences",
            "other-crime": "Other"
        };

        return mapNames[category] || "Other";
    }

    function buildSafetySummary(crimes) {
        const buckets = {
            violence: 0,
            robbery: 0,
            theft: 0,
            weapons: 0,
            sexual: 0,
            other: 0
        };

        if (!crimes.length) {
            return {
                score: null,
                riskLabel: "⚪ Limited Data",
                riskColor: "#64748b",
                insight: "No UK police crime data is available for this point. The score is limited outside the UK Police API coverage area.",
                buckets
            };
        }

        const weights = {
            "violent-crime": 14,
            "robbery": 18,
            "theft-from-the-person": 12,
            "bicycle-theft": 7,
            "shoplifting": 5,
            "other-theft": 6,
            "burglary": 10,
            "vehicle-crime": 8,
            "criminal-damage-arson": 7,
            "anti-social-behaviour": 4,
            "public-order": 5,
            "drugs": 4,
            "possession-of-weapons": 16,
            "sexual-offences": 22,
            "other-crime": 3
        };

        let weightedTotal = 0;

        crimes.forEach(crime => {
            const category = crime.category || "other-crime";
            weightedTotal += weights[category] || 4;

            if (category === "violent-crime") {
                buckets.violence += 1;
            } else if (category === "robbery") {
                buckets.robbery += 1;
            } else if (
                category === "theft-from-the-person" ||
                category === "bicycle-theft" ||
                category === "shoplifting" ||
                category === "other-theft" ||
                category === "vehicle-crime"
            ) {
                buckets.theft += 1;
            } else if (category === "possession-of-weapons") {
                buckets.weapons += 1;
            } else if (category === "sexual-offences") {
                buckets.sexual += 1;
            } else {
                buckets.other += 1;
            }
        });

        const penalty = Math.min(75, Math.round(weightedTotal / 8));
        const score = Math.max(0, 100 - penalty);

        let riskLabel = "🟢 Low Risk";
        let riskColor = "#137f49";

        if (score < 75 && score >= 50) {
            riskLabel = "🟡 Moderate Risk";
            riskColor = "#9a6b00";
        } else if (score < 50) {
            riskLabel = "🔴 High Risk";
            riskColor = "#b42318";
        }

        const ranked = Object.entries(buckets)
            .filter(([, value]) => value > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

        let insight = "No incidents returned for this point in the latest police dataset.";

        if (ranked.length) {
            insight = `Main local risks: ${ranked
                .map(([key, value]) => `${prettyCategory(key)} (${value})`)
                .join(", ")}.`;
        }

        if (score >= 75) {
            insight = `Lower-than-average crime activity here. ${insight}`;
        } else if (score >= 50) {
            insight = `Use caution and stay aware. ${insight}`;
        } else {
            insight = `Elevated risk in this area. ${insight}`;
        }

        return {
            score,
            riskLabel,
            riskColor,
            insight,
            buckets
        };
    }

    function getPointSafetyData(lat, lng) {
        const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;

        if (pointSafetyCache.has(key)) {
            return pointSafetyCache.get(key);
        }

        return fetchCrimeData(lat, lng).then(crimes => {
            const summary = buildSafetySummary(crimes);

            const data = {
                score: summary.score === null ? 100 : summary.score,
                riskLabel: summary.riskLabel,
                riskColor: summary.riskColor,
                insight: summary.insight,
                incidentCount: crimes.length,
                buckets: summary.buckets
            };

            pointSafetyCache.set(key, data);
            return data;
        });
    }

    async function scoreRoute(routeCoords) {
        const coords = routeCoords.map(coordToLatLng).filter(Boolean);

        if (coords.length < 2) {
            const risk = getRiskLabel(null);
            return {
                averageScore: null,
                incidentCount: 0,
                riskLabel: risk.label,
                riskColor: risk.color,
                saferRouteAvailable: false,
                tip: "No route safety data available.",
                buckets: {
                    violence: 0,
                    robbery: 0,
                    theft: 0,
                    weapons: 0,
                    sexual: 0,
                    other: 0
                }
            };
        }

        const maxSegments = 4;
        const step = Math.max(1, Math.floor((coords.length - 1) / maxSegments));
        const jobs = [];
        const routeScores = [];
        let incidentTotal = 0;

        const buckets = {
            violence: 0,
            robbery: 0,
            theft: 0,
            weapons: 0,
            sexual: 0,
            other: 0
        };

        for (let i = 0; i < coords.length - 1; i += step) {
            const segmentPath = coords.slice(i, Math.min(i + step + 1, coords.length));
            const mid = segmentPath[Math.floor(segmentPath.length / 2)];

            if (!mid) continue;

            jobs.push(
                (async () => {
                    const data = await getPointSafetyData(mid.lat, mid.lng);
                    routeScores.push(data.score);
                    incidentTotal += data.incidentCount;

                    buckets.violence += data.buckets?.violence || 0;
                    buckets.robbery += data.buckets?.robbery || 0;
                    buckets.theft += data.buckets?.theft || 0;
                    buckets.weapons += data.buckets?.weapons || 0;
                    buckets.sexual += data.buckets?.sexual || 0;
                    buckets.other += data.buckets?.other || 0;
                })()
            );
        }

        await Promise.all(jobs);

        const averageScore = routeScores.length
            ? Math.round(routeScores.reduce((a, b) => a + b, 0) / routeScores.length)
            : null;

        const risk = getRiskLabel(averageScore);

        return {
            averageScore,
            incidentCount: incidentTotal,
            riskLabel: risk.label,
            riskColor: risk.color,
            saferRouteAvailable: averageScore !== null && averageScore < 65,
            tip: averageScore === null
                ? "No route safety data available."
                : averageScore >= 75
                    ? "Safer route recommended. Stay aware near busy transport points."
                    : averageScore >= 50
                        ? "Moderate risk detected. Keep valuables secure and stay alert."
                        : "Higher-risk route detected. Consider an alternative path.",
            buckets
        };
    }

    async function analyseRouteOption(points) {
        const route = await fetchOsrmRoute(points);

        if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates)) {
            return null;
        }

        const routeCoords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const analysis = await scoreRoute(routeCoords);

        return {
            route,
            routeCoords,
            analysis,
            points
        };
    }

    async function buildRouteCandidates(routeOptions) {
        const candidates = await Promise.all(
            routeOptions.map(async (option, index) => {
                const result = await analyseRouteOption(option.points);

                if (!result) return null;

                return {
                    id: index,
                    name: option.name,
                    ...result
                };
            })
        );

        const filtered = candidates.filter(Boolean);

        const fastest = [...filtered].sort((a, b) => a.route.duration - b.route.duration)[0] || null;

        let safest = [...filtered].sort((a, b) => {
            const aScore = a.analysis.averageScore === null ? -1 : a.analysis.averageScore;
            const bScore = b.analysis.averageScore === null ? -1 : b.analysis.averageScore;
            if (aScore !== bScore) return bScore - aScore;
            return a.route.duration - b.route.duration;
        })[0] || null;

        if (filtered.length > 1 && safest && fastest && safest === fastest) {
            safest = filtered.find(candidate => candidate !== fastest) || safest;
        }

        if (DEBUG_ROUTE_ALTERNATIVES) {
            const fastestDuration = fastest ? Math.round(fastest.route.duration / 60) : null;
            const safestDuration = safest ? Math.round(safest.route.duration / 60) : null;
            const fastestScore = fastest?.analysis?.averageScore ?? "N/A";
            const safestScore = safest?.analysis?.averageScore ?? "N/A";
            const difference =
                (safest?.analysis?.averageScore !== null && fastest?.analysis?.averageScore !== null)
                    ? safest.analysis.averageScore - fastest.analysis.averageScore
                    : null;

            console.groupCollapsed("Route Comparison Debug");
            console.log(`Routes returned: ${filtered.length}`);
            console.log("\nFastest Route:");
            console.log(`Duration: ${fastestDuration !== null ? `${fastestDuration} mins` : "N/A"}`);
            console.log(`Safety Score: ${fastestScore}`);
            console.log("\nSafest Route:");
            console.log(`Duration: ${safestDuration !== null ? `${safestDuration} mins` : "N/A"}`);
            console.log(`Safety Score: ${safestScore}`);
            if (difference !== null) {
                const sign = difference >= 0 ? "+" : "";
                console.log(`\nDifference: ${sign}${difference}`);
            }
            console.groupEnd();
        }

        return { candidates: filtered, fastest, safest };
    }

    async function renderSafetyRoute(routeCoords) {
        if (routeOverlayGroup) {
            map.removeLayer(routeOverlayGroup);
        }

        routeOverlayGroup = L.layerGroup().addTo(map);

        const coords = routeCoords.map(coordToLatLng).filter(Boolean);

        if (coords.length < 2) {
            return null;
        }

        const maxSegments = 4;
        const step = Math.max(1, Math.floor((coords.length - 1) / maxSegments));
        const jobs = [];
        const routeScores = [];
        let incidentTotal = 0;

        const buckets = {
            violence: 0,
            robbery: 0,
            theft: 0,
            weapons: 0,
            sexual: 0,
            other: 0
        };

        for (let i = 0; i < coords.length - 1; i += step) {
            const segmentPath = coords.slice(i, Math.min(i + step + 1, coords.length));
            const mid = segmentPath[Math.floor(segmentPath.length / 2)];

            if (!mid) continue;

            jobs.push(
                (async () => {
                    const data = await getPointSafetyData(mid.lat, mid.lng);
                    routeScores.push(data.score);
                    incidentTotal += data.incidentCount;

                    buckets.violence += data.buckets?.violence || 0;
                    buckets.robbery += data.buckets?.robbery || 0;
                    buckets.theft += data.buckets?.theft || 0;
                    buckets.weapons += data.buckets?.weapons || 0;
                    buckets.sexual += data.buckets?.sexual || 0;
                    buckets.other += data.buckets?.other || 0;

                    const color = getRouteColor(data.score);

                    L.polyline(segmentPath, {
                        color,
                        weight: 8,
                        opacity: 0.95,
                        lineCap: "round",
                        lineJoin: "round"
                    }).addTo(routeOverlayGroup);
                })()
            );
        }

        await Promise.all(jobs);

        const avgScore = routeScores.length
            ? Math.round(routeScores.reduce((a, b) => a + b, 0) / routeScores.length)
            : null;

        const risk = getRiskLabel(avgScore);

        return {
            averageScore: avgScore,
            incidentCount: incidentTotal,
            riskLabel: risk.label,
            riskColor: risk.color,
            saferRouteAvailable: avgScore !== null && avgScore < 65,
            tip: avgScore === null
                ? "No route safety data available."
                : avgScore >= 75
                    ? "Safer route recommended. Stay aware near busy transport points."
                    : avgScore >= 50
                        ? "Moderate risk detected. Keep valuables secure and stay alert."
                        : "Higher-risk route detected. Consider an alternative path.",
            buckets
        };
    }

    async function searchLocation(query) {
        const cleanQuery = query.trim();

        if (cleanQuery.length < 2) {
            return [];
        }

        try {
            const response = await fetch(
                `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(cleanQuery)}&limit=8&apiKey=${GEOAPIFY_KEY}`
            );

            const data = await response.json();

            if (!data.features || !Array.isArray(data.features)) {
                return [];
            }

            const results = data.features.map(feature => ({
                display_name: feature.properties.formatted,
                lat: feature.properties.lat,
                lon: feature.properties.lon,
                country_code: feature.properties.country_code || ""
            }));

            results.sort((a, b) => {
                const aPreferred = preferredCountries.has(String(a.country_code).toLowerCase()) ? 0 : 1;
                const bPreferred = preferredCountries.has(String(b.country_code).toLowerCase()) ? 0 : 1;
                return aPreferred - bPreferred;
            });

            return results;
        } catch (error) {
            console.log("searchLocation error:", error);
            return [];
        }
    }

    async function geocodeSinglePlace(place) {
        const results = await searchLocation(place);
        return results[0] || null;
    }

    async function getAreaName(lat, lng) {
        try {
            const response = await fetch(
                `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${GEOAPIFY_KEY}`
            );

            const data = await response.json();
            const props = data.features?.[0]?.properties || {};

            const area =
                props.suburb ||
                props.neighbourhood ||
                props.county ||
                props.city ||
                props.town ||
                props.state ||
                "London";

            currentAreaEl.textContent = `📍 ${area}`;
            currentAreaMini.textContent = area;

            return area;
        } catch (error) {
            console.log("getAreaName error:", error);
            currentAreaEl.textContent = "📍 London";
            currentAreaMini.textContent = "London";
            return "London";
        }
    }

    function updateCrimeChart(buckets) {
        crimeChart.data.labels = ["Violence", "Robbery", "Theft", "Weapons", "Sexual Offences", "Other"];

        crimeChart.data.datasets[0].data = [
            buckets.violence,
            buckets.robbery,
            buckets.theft,
            buckets.weapons,
            buckets.sexual,
            buckets.other
        ];

        crimeChart.update();
    }

    function updateCrimeGrid(buckets) {
        const items = [
            ["Violence", buckets.violence],
            ["Robbery", buckets.robbery],
            ["Theft", buckets.theft],
            ["Weapons", buckets.weapons],
            ["Sexual Offences", buckets.sexual],
            ["Other", buckets.other]
        ];

        const max = Math.max(...items.map(([, count]) => count), 1);

        crimeGrid.innerHTML = items.map(([label, count]) => {
            const width = Math.max(10, Math.round((count / max) * 100));

            return `
                <div class="crime-item">
                    <div class="crime-item-top">
                        <label>${label}</label>
                        <strong>${count}</strong>
                    </div>
                    <div class="crime-bar"><span style="width:${width}%"></span></div>
                </div>
            `;
        }).join("");
    }

    function updateSafetyUI(summary) {
        scoreEl.textContent = summary.score === null ? "—" : summary.score;
        riskEl.textContent = summary.riskLabel;
        riskEl.style.color = summary.riskColor;
        insightEl.textContent = summary.insight;

        safetyScoreMini.textContent = summary.score === null ? "—" : summary.score;
        riskMini.textContent = summary.riskLabel.replace(/[🟢🟡🔴⚪]/g, "").trim();

        const incidentsText = summary.score === null
            ? "—"
            : summary.buckets.violence +
              summary.buckets.robbery +
              summary.buckets.theft +
              summary.buckets.weapons +
              summary.buckets.sexual +
              summary.buckets.other;

        incidentsMini.textContent = incidentsText > 999 ? "999+" : incidentsText;
        tipMini.textContent = summary.insight;
    }

    function updateRouteSummary(route, routeAnalysis) {
        if (!route) return;

        distanceMini.textContent = formatDistance(route.distance);
        timeMini.textContent = estimateWalkingTime(route.distance);

        if (routeAnalysis) {
            safetyScoreMini.textContent = routeAnalysis.averageScore === null ? "—" : routeAnalysis.averageScore;
            riskMini.textContent = routeAnalysis.riskLabel.replace(/[🟢🟡🔴⚪]/g, "").trim();

            incidentsMini.textContent =
                routeAnalysis.incidentCount > 999
                    ? "999+"
                    : routeAnalysis.incidentCount;

            tipMini.textContent = routeAnalysis.tip;
            riskEl.textContent = routeAnalysis.riskLabel;
            riskEl.style.color = routeAnalysis.riskColor;

            routeSafety.textContent =
                routeAnalysis.averageScore === null ? "—" : routeAnalysis.averageScore;

            if (routeAnalysis.averageScore === null) {
                routeSafetyText.textContent = "Checking";
            } else if (routeAnalysis.averageScore >= 75) {
                routeSafetyText.textContent = "Low Risk Route";
            } else if (routeAnalysis.averageScore >= 50) {
                routeSafetyText.textContent = "Moderate Risk Route";
            } else {
                routeSafetyText.textContent = "Higher Risk Route";
            }

            if (routeCandidates.length > 1) {
                const fastestScore = fastestRouteCandidate?.analysis?.averageScore ?? 0;
                const safestScore = safestRouteCandidate?.analysis?.averageScore ?? 0;
                const diff = safestScore - fastestScore;

                alternativeRoute.textContent = "Available";
                alternativeRouteText.textContent =
                    diff > 0
                        ? `Safer by ${diff} pts`
                        : diff < 0
                            ? `Faster by ${Math.abs(diff)} pts`
                            : "Alternative route available";
            } else {
                alternativeRoute.textContent = "Not available";
                alternativeRouteText.textContent = "Only one route found";
            }
        }
    }

    async function refreshSafetyContext(lat, lng, force = false) {
        const now = Date.now();

        if (!force && now - lastCrimeRefresh < CRIME_REFRESH_MS) {
            return;
        }

        lastCrimeRefresh = now;

        const crimes = await fetchCrimeData(lat, lng);

        const summary = buildSafetySummary(crimes);
        updateSafetyUI(summary);
        updateCrimeChart(summary.buckets);
        updateCrimeGrid(summary.buckets);
        await getAreaName(lat, lng);
    }

    function clearDropdownOnBlur(dropdown) {
        setTimeout(() => clearDropdown(dropdown), 150);
    }

    async function setupAutocomplete(input, dropdown, saveFunction) {
        let timer = null;

        input.addEventListener("input", () => {
            if (input.id === "startLocation") {
                selectedStartResult = null;
            } else if (input.id === "destination") {
                selectedDestinationResult = null;
            }

            const query = input.value.trim();

            clearTimeout(timer);

            if (query.length < 2) {
                clearDropdown(dropdown);
                return;
            }

            timer = setTimeout(async () => {
                const results = await searchLocation(query);
                clearDropdown(dropdown);

                results.forEach(location => {
                    const item = document.createElement("div");
                    item.className = "dropdown-item";
                    item.textContent = location.display_name;

                    item.addEventListener("mousedown", (event) => {
                        event.preventDefault();
                        input.value = location.display_name;
                        saveFunction(location);
                        clearDropdown(dropdown);
                    });

                    dropdown.appendChild(item);
                });
            }, 250);
        });

        input.addEventListener("blur", () => clearDropdownOnBlur(dropdown));

        input.addEventListener("focus", () => {
            if (input.value.trim().length >= 2) {
                input.dispatchEvent(new Event("input"));
            }
        });
    }

    setupAutocomplete(startInput, startDropdown, (location) => {
        selectedStartResult = location;
    });

    setupAutocomplete(destinationInput, destinationDropdown, (location) => {
        selectedDestinationResult = location;
    });

    async function renderSafetyRoute(routeCoords) {
        if (routeOverlayGroup) {
            map.removeLayer(routeOverlayGroup);
        }

        routeOverlayGroup = L.layerGroup().addTo(map);

        const coords = routeCoords.map(coordToLatLng).filter(Boolean);

        if (coords.length < 2) {
            return null;
        }

        const maxSegments = 4;
        const step = Math.max(1, Math.floor((coords.length - 1) / maxSegments));
        const jobs = [];
        const routeScores = [];
        let incidentTotal = 0;

        const buckets = {
            violence: 0,
            robbery: 0,
            theft: 0,
            weapons: 0,
            sexual: 0,
            other: 0
        };

        for (let i = 0; i < coords.length - 1; i += step) {
            const segmentPath = coords.slice(i, Math.min(i + step + 1, coords.length));
            const mid = segmentPath[Math.floor(segmentPath.length / 2)];

            if (!mid) continue;

            jobs.push(
                (async () => {
                    const data = await getPointSafetyData(mid.lat, mid.lng);
                    routeScores.push(data.score);
                    incidentTotal += data.incidentCount;

                    buckets.violence += data.buckets?.violence || 0;
                    buckets.robbery += data.buckets?.robbery || 0;
                    buckets.theft += data.buckets?.theft || 0;
                    buckets.weapons += data.buckets?.weapons || 0;
                    buckets.sexual += data.buckets?.sexual || 0;
                    buckets.other += data.buckets?.other || 0;

                    const color = getRouteColor(data.score);

                    L.polyline(segmentPath, {
                        color,
                        weight: 8,
                        opacity: 0.95,
                        lineCap: "round",
                        lineJoin: "round"
                    }).addTo(routeOverlayGroup);
                })()
            );
        }

        await Promise.all(jobs);

        const avgScore = routeScores.length
            ? Math.round(routeScores.reduce((a, b) => a + b, 0) / routeScores.length)
            : null;

        const risk = getRiskLabel(avgScore);

        return {
            averageScore: avgScore,
            incidentCount: incidentTotal,
            riskLabel: risk.label,
            riskColor: risk.color,
            saferRouteAvailable: avgScore !== null && avgScore < 65,
            tip: avgScore === null
                ? "No route safety data available."
                : avgScore >= 75
                    ? "Safer route recommended. Stay aware near busy transport points."
                    : avgScore >= 50
                        ? "Moderate risk detected. Keep valuables secure and stay alert."
                        : "Higher-risk route detected. Consider an alternative path.",
            buckets
        };
    }

    async function displayRouteCandidate(candidate, alternativeCandidate = null) {
        if (!candidate) return;

        clearRouteVisuals(true);

        baseRouteLine = L.polyline(candidate.routeCoords, {
            color: "#dbe3ee",
            opacity: 0.95,
            weight: 10
        }).addTo(map);

        map.fitBounds(baseRouteLine.getBounds().pad(0.18), {
            padding: [40, 40],
            maxZoom: 16
        });

        routeAnalysisInProgress = true;

        const routeAnalysis = await renderSafetyRoute(candidate.routeCoords).catch(error => {
            console.log("renderSafetyRoute error:", error);
            return null;
        });

        routeAnalysisInProgress = false;

        const analysis = routeAnalysis || candidate.analysis;
        analysis.saferRouteAvailable =
            routeCandidates.length > 1 &&
            Boolean(alternativeCandidate) &&
            alternativeCandidate !== candidate;

        updateRouteSummary(candidate.route, analysis);

        updateCrimeGrid(analysis.buckets || candidate.analysis.buckets || {
            violence: 0,
            robbery: 0,
            theft: 0,
            weapons: 0,
            sexual: 0,
            other: 0
        });

        activeRouteMode = (candidate === fastestRouteCandidate) ? "fastest" : "safest";

        routeStatus.textContent = routeCandidates.length > 1
            ? "Fastest route shown. Tap Alternative Route to switch."
            : "Only one route found.";

        setJourneyStatus(
            activeRouteMode === "fastest"
                ? "Fastest route shown."
                : "Safest route shown."
        );
    }

    function toggleRouteMode() {
        if (!fastestRouteCandidate || !safestRouteCandidate) {
            alert("No route available.");
            return;
        }

        if (fastestRouteCandidate === safestRouteCandidate) {
            alert("Only one route available.");
            return;
        }

        activeRouteMode = activeRouteMode === "fastest" ? "safest" : "fastest";

        const nextCandidate =
            activeRouteMode === "fastest"
                ? fastestRouteCandidate
                : safestRouteCandidate;

        const altCandidate =
            activeRouteMode === "fastest"
                ? safestRouteCandidate
                : fastestRouteCandidate;

        displayRouteCandidate(nextCandidate, altCandidate);
    }

    alternativeRoute.style.cursor = "pointer";
    alternativeRouteText.style.cursor = "pointer";
    alternativeRoute.addEventListener("click", toggleRouteMode);
    alternativeRouteText.addEventListener("click", toggleRouteMode);

    function startJourneyTracking() {
        if (!navigator.geolocation) {
            alert("Geolocation is not supported in this browser.");
            return;
        }

        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
        }

        setJourneyStatus("Live tracking active — following your current location.");

        watchId = navigator.geolocation.watchPosition(
            async (position) => {
                currentLat = position.coords.latitude;
                currentLng = position.coords.longitude;

                if (trackingMarker) {
                    trackingMarker.setLatLng([currentLat, currentLng]);
                } else {
                    trackingMarker = L.marker([currentLat, currentLng], {
                        title: "Your location"
                    }).addTo(map);
                }

                map.panTo([currentLat, currentLng]);

                const shouldRefresh =
                    lastCrimeRefresh === 0 ||
                    (Date.now() - lastCrimeRefresh >= CRIME_REFRESH_MS);

                if (shouldRefresh) {
                    await refreshSafetyContext(currentLat, currentLng, true);
                } else {
                    await getAreaName(currentLat, currentLng);
                }
            },
            (error) => {
                console.log("Tracking error:", error);
                alert("Could not start live tracking.");
                setJourneyStatus("Live tracking could not start.");
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }

    locationBtn.addEventListener("click", () => {
        if (!navigator.geolocation) {
            alert("Geolocation is not supported in this browser.");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                currentLat = position.coords.latitude;
                currentLng = position.coords.longitude;

                map.setView([currentLat, currentLng], 14);

                if (trackingMarker) {
                    trackingMarker.setLatLng([currentLat, currentLng]);
                } else {
                    trackingMarker = L.marker([currentLat, currentLng], {
                        title: "Your location"
                    }).addTo(map);
                }

                await refreshSafetyContext(currentLat, currentLng, true);
            },
            (error) => {
                console.log("Geolocation error:", error);
                alert("Could not access your location.");
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });

    shareBtn.addEventListener("click", () => {
        if (!currentLat || !currentLng) {
            alert("Please use your location first.");
            return;
        }

        const link = `https://www.google.com/maps?q=${currentLat},${currentLng}`;

        navigator.clipboard.writeText(link);
        alert("Location link copied. Share it with a trusted contact.");
    });

    emergencyBtn.addEventListener("click", () => {
        window.location.href = "tel:999";
    });

    crimeBtn.addEventListener("click", () => {
        crimeDrawer.classList.add("open");
        crimeDrawer.setAttribute("aria-hidden", "false");
        setTimeout(() => crimeChart.resize(), 100);
    });

    closeCrimeDrawer.addEventListener("click", () => {
        crimeDrawer.classList.remove("open");
        crimeDrawer.setAttribute("aria-hidden", "true");
    });

    summaryToggle.addEventListener("click", () => {
        summaryExpanded = !summaryExpanded;
        summaryStrip.classList.toggle("collapsed", !summaryExpanded);
    });

    async function clearAndDrawRoute(startLatLng, destinationLatLng) {
        clearRouteVisuals();

        startRouteMarker = L.marker(startLatLng, { title: "Start" })
            .addTo(map)
            .bindPopup("Start");

        endRouteMarker = L.marker(destinationLatLng, { title: "Destination" })
            .addTo(map)
            .bindPopup("Destination");

        try {
            setJourneyStatus("Planning safest walking route...");
            routeStatus.textContent = "Calculating route options...";

            const detourLeft = buildDetourWaypoint(startLatLng, destinationLatLng, -1);
            const detourRight = buildDetourWaypoint(startLatLng, destinationLatLng, 1);

            const routeOptions = [
                { name: "fastest", points: [startLatLng, destinationLatLng] },
                { name: "detour-left", points: [startLatLng, detourLeft, destinationLatLng] },
                { name: "detour-right", points: [startLatLng, detourRight, destinationLatLng] }
            ];

            const analysed = await buildRouteCandidates(routeOptions);

            routeCandidates = analysed.candidates;
            fastestRouteCandidate = analysed.fastest;
            safestRouteCandidate = analysed.safest;
            routeHasMeaningfulAlternative =
                routeCandidates.length > 1 &&
                fastestRouteCandidate &&
                safestRouteCandidate &&
                fastestRouteCandidate !== safestRouteCandidate;

            if (!fastestRouteCandidate) {
                throw new Error("No walking route geometry returned");
            }

            activeRouteMode = "fastest";

            await displayRouteCandidate(
                fastestRouteCandidate,
                routeHasMeaningfulAlternative ? safestRouteCandidate : null
            );

            await refreshSafetyContext(startLatLng[0], startLatLng[1], true);
        } catch (error) {
            console.log("route fetch error:", error);

            fallbackRouteLine = L.polyline([startLatLng, destinationLatLng], {
                color: "#111111",
                opacity: 0.85,
                weight: 6,
                dashArray: "8, 8"
            }).addTo(map);

            map.fitBounds(fallbackRouteLine.getBounds().pad(0.25), {
                padding: [40, 40],
                maxZoom: 16
            });

            setJourneyStatus("Preview route shown. Tap Start Journey to begin live tracking.");
            distanceMini.textContent = "—";
            timeMini.textContent = "—";
            routeStatus.textContent = "Preview route shown.";
            alternativeRoute.textContent = "Not available";
            alternativeRouteText.textContent = "No route found";
        }
    }

    routeBtn.addEventListener("click", async () => {
        const startValue = startInput.value.trim();
        const destinationValue = destinationInput.value.trim();

        if (!startValue || !destinationValue) {
            alert("Enter both locations");
            return;
        }

        setJourneyStatus("Planning safest walking route...");
        routeStatus.textContent = "Calculating route...";
        
        let startResult = selectedStartResult;
        let destinationResult = selectedDestinationResult;

        if (!startResult) {
            startResult = await geocodeSinglePlace(startValue);
        }

        if (!destinationResult) {
            destinationResult = await geocodeSinglePlace(destinationValue);
        }

        if (!startResult || !destinationResult) {
            alert("Please choose valid locations from the suggestions, or refine your search.");
            setJourneyStatus("Could not find both locations.");
            return;
        }

        selectedStartResult = startResult;
        selectedDestinationResult = destinationResult;

        startInput.value = startResult.display_name;
        destinationInput.value = destinationResult.display_name;

        clearDropdown(startDropdown);
        clearDropdown(destinationDropdown);

        const startLatLng = [
            parseFloat(startResult.lat),
            parseFloat(startResult.lon)
        ];

        const destinationLatLng = [
            parseFloat(destinationResult.lat),
            parseFloat(destinationResult.lon)
        ];

        await clearAndDrawRoute(startLatLng, destinationLatLng);
    });

    trackingBtn.addEventListener("click", () => {
        startJourneyTracking();
    });

    riskEl.style.color = "#137f49";
    currentAreaMini.textContent = "London";
});