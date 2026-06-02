# 🛡️ SafeWalk London

### UAL Creative Computing Institute

Computational Practices: Visualisation and Sensing (2025/26)
Jafrin Maria Ahmed

---

## Overview

SafeWalk London is a web-based route planning and safety visualisation application that combines interactive mapping, live geolocation sensing, route generation and public crime data.

The project explores how publicly available data can be transformed into a practical navigation tool that helps users make more informed walking decisions. Rather than focusing solely on distance and travel time, SafeWalk London introduces safety-aware visualisation through route scoring, crime breakdowns and contextual location information.

This project was developed for the **Computational Practices: Visualisation and Sensing** module at UAL Creative Computing Institute.

---

## Features

* Interactive full-screen map interface
* Address and postcode autocomplete
* Walking route planning
* Live geolocation tracking
* Current area detection
* Crime data integration
* Route safety scoring
* Crime breakdown visualisation
* Emergency contact button
* Location sharing
* Alternative route comparison
* Mobile-friendly responsive design

---

## Technologies Used

### Frontend

* HTML5
* CSS3
* JavaScript

### Mapping & Visualisation

* Leaflet
* Chart.js

### APIs

* Geoapify Geocoding API
* UK Police API
* Open Source Routing Machine (OSRM)
* Browser Geolocation API

---

## Project Structure

```text
SafeWalk-London/
│
├── index.html
├── style.css
├── script.js
├── README.md
│
└── assets/
    ├── screenshots/
    └── design-process/
```

## Running the Project

1. Clone the repository.

```bash
git clone [repository-url]
```

2. Open the project folder in VS Code.

3. Launch the project using Live Server.

4. Allow location permissions when prompted.

5. Enter a start location and destination.

6. Click **Plan Route** to generate a route.

7. Click **Start Journey** to begin live tracking.

---

## Design Rationale

SafeWalk London was inspired by the idea that navigation is not only about finding the fastest route, but also about understanding the environment through which a person travels.

The interface takes inspiration from modern mapping applications such as Apple Maps and Life360, using a full-screen map, floating controls and lightweight information panels to prioritise clarity and usability.

The project explores how data visualisation and sensing technologies can be combined to create a more contextual approach to route planning.

---

## Data Sources

### Geoapify

Used for:

* Address autocomplete
* Postcode search
* Reverse geocoding

### UK Police API

Used for:

* Street-level crime data
* Crime category analysis
* Safety scoring

### OSRM

Used for:

* Walking route generation
* Route geometry

---

## Future Development

Potential future improvements include:

* Trusted contact sharing
* Real-time journey monitoring
* User accounts and authentication
* Push notifications
* Advanced route optimisation
* Enhanced risk modelling
* Personalised safety preferences

---

## Project Link

**Live Application:**
https://jmariahmed.github.io/SafeWalk-London/

---

## Author

**Jafrin Maria Ahmed**
UAL Creative Computing Institute
Computational Practices: Visualisation and Sensing (2025/26)

---

## References

Geoapify. Available at: https://www.geoapify.com

Leaflet. Available at: https://leafletjs.com

Open Source Routing Machine (OSRM). Available at: https://project-osrm.org

UK Police API. Available at: https://data.police.uk

Chart.js. Available at: https://www.chartjs.org
