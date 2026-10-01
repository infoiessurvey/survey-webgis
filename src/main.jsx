import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createRoot } from "react-dom/client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import "leaflet-measure";
import "leaflet-measure/dist/leaflet-measure.css";

import Papa from "papaparse";
import proj4 from "proj4";
import shp from "shpjs";
import { kml } from "@tmcw/togeojson";

import "./styles.css";

/* =========================================================
   SUPABASE STORAGE
========================================================= */

const SUPABASE_URL =
  "https://rrhmbcskbntklkjqefwe.supabase.co";

const BUCKET = "survey-files";

/* =========================================================
   PROJECT CONFIGURATION
========================================================= */

const PROJECTS = [
  {
    id: "jilli",
    name: "Jilli Chumli Khola Hydropower Survey",
    code: "JILLI",
    year: 2026,
    location: "Kalikot, Nepal",
    epsg: "EPSG:32644",

    controlPath:
      "JILLI/Control points/Jilli Chumli Project.csv",

    boundaryPath:
      "JILLI/Survey Boundary/survey_boundary.kml",

    crossPath:
      "JILLI/Cross Sections/cross_sections.kml",

    photoFolder:
      "JILLI/photos/",
  },

  {
    id: "kankai",
    name: "Kankai Survey",
    code: "KANKAI",
    year: 2026,
    location: "Jhapa, Nepal",
    epsg: "EPSG:32645",

    controlPath:
      "KANKAI/Control points/control points.csv",

    boundaryPath: null,

    crossPath:
      "KANKAI/Cross section/Cross_Sections.kml",

    photoFolder:
      "KANKAI/photos/",
  },

  {
    id: "bheri",
    name: "Bheri Survey",
    code: "BHERI",
    year: 2026,
    location: "Salyan and Surkhet, Nepal",
    epsg: "EPSG:32644",

    controlPath:
      "BHERI/Control points/control points.csv",

    boundaryPath:
      "BHERI/Survey boundary/Survey boundary.kml",

    crossPath:
      "BHERI/Cross Sections/cross_sections.kml",

    photoFolder:
      "BHERI/photos/",
  },
];

/* =========================================================
   COMMON DATA
========================================================= */

const COMMON_TRIG_PATH =
  "COMMON/TRIG_BM/trig_points.csv";

/* =========================================================
   PUBLIC SUPABASE STORAGE URL
========================================================= */

function publicUrl(path) {
  if (!path) return "";

  const cleanPath = String(path)
    .replace(/^\/+/, "");

  return (
    `${SUPABASE_URL}/storage/v1/object/public/` +
    `${BUCKET}/` +
    cleanPath
      .split("/")
      .map((part) =>
        encodeURIComponent(part)
      )
      .join("/")
  );
}

/* =========================================================
   HELPERS
========================================================= */

function cleanValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/^\uFEFF/, "")
    .trim();
}

function normalizeHeader(value) {
  return cleanValue(value)
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstExisting(row, names) {
  const keys = Object.keys(row || {});

  const normalizedKeys =
    keys.map((key) => ({
      original: key,
      normalized:
        normalizeHeader(key),
    }));

  for (const name of names) {
    const wanted =
      normalizeHeader(name);

    const found =
      normalizedKeys.find(
        (item) =>
          item.normalized === wanted
      );

    if (found) {
      return row[found.original];
    }
  }

  return "";
}

function numberValue(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return NaN;
  }

  const text =
    String(value)
      .replace(/\uFEFF/g, "")
      .replace(/,/g, "")
      .trim();

  const n = Number(text);

  return n;
}

function isValidLatLng(
  lat,
  lng
) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/* =========================================================
   DETECT CSV HEADER ROW

   This is important for the common Trig/BM CSV.

   Example supported CSV:

   Survey Trig Points
   Nepal Survey
   Date,2026

   Station Name,Latitude,Longitude,Elevation,Remarks
   TRIG-1,28.123,81.123,500,Good
   TRIG-2,28.124,81.124,501,Good

   The old parser assumed the first line was the header.
========================================================= */

function detectCSVHeaderRow(
  text,
  preferredHeaders = []
) {
  const cleanText =
    String(text || "")
      .replace(/^\uFEFF/, "");

  const parsed =
    Papa.parse(
      cleanText,
      {
        header: false,
        skipEmptyLines: true,
        dynamicTyping: false,
      }
    );

  const rows =
    parsed.data || [];

  if (!rows.length) {
    return -1;
  }

  const preferred =
    preferredHeaders.map(
      normalizeHeader
    );

  let bestIndex = -1;
  let bestScore = 0;

  rows.forEach(
    (row, index) => {
      if (
        index > 100
      ) {
        return;
      }

      const cells =
        row.map(
          normalizeHeader
        );

      let score = 0;

      cells.forEach(
        (cell) => {
          if (!cell) {
            return;
          }

          if (
            preferred.includes(
              cell
            )
          ) {
            score += 2;
          }

          if (
            cell.includes(
              "latitude"
            )
          ) {
            score += 2;
          }

          if (
            cell.includes(
              "longitude"
            )
          ) {
            score += 2;
          }

          if (
            cell === "easting" ||
            cell.includes(
              "utm easting"
            )
          ) {
            score += 2;
          }

          if (
            cell === "northing" ||
            cell.includes(
              "utm northing"
            )
          ) {
            score += 2;
          }

          if (
            cell === "station" ||
            cell.includes(
              "station name"
            )
          ) {
            score += 2;
          }

          if (
            cell === "name" ||
            cell === "point"
          ) {
            score += 1;
          }

          if (
            cell === "elevation" ||
            cell === "msl" ||
            cell === "rl"
          ) {
            score += 1;
          }
        }
      );

      if (
        score > bestScore
      ) {
        bestScore =
          score;

        bestIndex =
          index;
      }
    }
  );

  return bestIndex;
}

/* =========================================================
   PARSE CSV WITH AUTO HEADER DETECTION
========================================================= */

function parseCSVWithDetectedHeader(
  text,
  preferredHeaders = []
) {
  const cleanText =
    String(text || "")
      .replace(/^\uFEFF/, "");

  const headerIndex =
    detectCSVHeaderRow(
      cleanText,
      preferredHeaders
    );

  console.log(
    "Detected CSV header row:",
    headerIndex
  );

  if (
    headerIndex < 0
  ) {
    return {
      rows: [],
      fields: [],
      headerIndex: -1,
    };
  }

  const parsed =
    Papa.parse(
      cleanText,
      {
        header: false,
        skipEmptyLines: true,
        dynamicTyping: false,
      }
    );

  const allRows =
    parsed.data || [];

  const header =
    allRows[
      headerIndex
    ];

  if (!header) {
    return {
      rows: [],
      fields: [],
      headerIndex,
    };
  }

  const fields =
    header.map(
      (field, index) =>
        cleanValue(
          field
        ) ||
        `Column_${index + 1}`
    );

  const rows =
    allRows
      .slice(
        headerIndex + 1
      )
      .map(
        (values) => {
          const row = {};

          fields.forEach(
            (
              field,
              index
            ) => {
              row[field] =
                values[index] ??
                "";
            }
          );

          return row;
        }
      )
      .filter(
        (row) =>
          Object.values(
            row
          ).some(
            (value) =>
              cleanValue(
                value
              ) !== ""
          )
      );

  console.log(
    "Detected CSV columns:",
    fields
  );

  console.log(
    "CSV data rows:",
    rows.length
  );

  return {
    rows,
    fields,
    headerIndex,
  };
}

/* =========================================================
   UTM TO WGS84
========================================================= */

function utmToLatLng(
  easting,
  northing,
  epsg
) {
  if (
    !Number.isFinite(easting) ||
    !Number.isFinite(northing) ||
    easting === 0 ||
    northing === 0 ||
    !epsg
  ) {
    return null;
  }

  try {
    const [
      longitude,
      latitude,
    ] = proj4(
      epsg,
      "EPSG:4326",
      [
        easting,
        northing,
      ]
    );

    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    ) {
      return [
        latitude,
        longitude,
      ];
    }

    return null;
  } catch (error) {
    console.error(
      "Coordinate transformation failed:",
      error
    );

    return null;
  }
}

/* =========================================================
   DETECT UTM EPSG FROM CSV ROW
========================================================= */

function detectUTMEPSG(
  row,
  fallbackEPSG = null
) {
  const explicitEPSG =
    cleanValue(
      firstExisting(
        row,
        [
          "EPSG",
          "EPSG Code",
          "CRS",
          "Coordinate System",
          "Projection",
        ]
      )
    );

  if (
    /^epsg:\d+$/i.test(
      explicitEPSG
    )
  ) {
    return explicitEPSG.toUpperCase();
  }

  if (
    /^\d+$/.test(
      explicitEPSG
    )
  ) {
    return `EPSG:${explicitEPSG}`;
  }

  const zoneValue =
    cleanValue(
      firstExisting(
        row,
        [
          "UTM Zone",
          "Zone",
          "UTM_Z",
          "UTMZone",
          "Zone No",
          "Zone Number",
        ]
      )
    );

  const zoneMatch =
    zoneValue.match(
      /\b(43|44|45|46)\b/
    );

  if (zoneMatch) {
    return `EPSG:${
      32600 +
      Number(
        zoneMatch[1]
      )
    }`;
  }

  return fallbackEPSG;
}

/* =========================================================
   CONTROL POINT CSV
========================================================= */

function parseControlCSV(
  text,
  epsg
) {
  const parsed =
    parseCSVWithDetectedHeader(
      text,
      [
        "Station",
        "Station Name",
        "Point",
        "Point Name",
        "Easting",
        "Northing",
        "Latitude",
        "Longitude",
      ]
    );

  const rows =
    parsed.rows || [];

  const points = [];

  rows.forEach(
    (row, index) => {
      const station =
        cleanValue(
          firstExisting(
            row,
            [
              "Station",
              "Station Name",
              "Point",
              "Point Name",
              "Name",
              "ID",
              "Point ID",
              "Control Point",
              "Control Point Name",
              "Ref",
              "Reference",
            ]
          )
        );

      const easting =
        numberValue(
          firstExisting(
            row,
            [
              "Easting",
              "E",
              "UTM Easting",
              "UTM_Easting",
              "X",
            ]
          )
        );

      const northing =
        numberValue(
          firstExisting(
            row,
            [
              "Northing",
              "N",
              "UTM Northing",
              "UTM_Northing",
              "Y",
            ]
          )
        );

      const elevation =
        firstExisting(
          row,
          [
            "Elevation",
            "Elev",
            "RL",
            "Height",
            "Z",
            "Reduced Level",
          ]
        );

      const lat =
        numberValue(
          firstExisting(
            row,
            [
              "Latitude",
              "Lat",
            ]
          )
        );

      const lng =
        numberValue(
          firstExisting(
            row,
            [
              "Longitude",
              "Long",
              "Lon",
              "Lng",
            ]
          )
        );

      const hasValidUTM =
        Number.isFinite(easting) &&
        Number.isFinite(northing) &&
        easting > 100000 &&
        northing > 100000;

      const hasValidLatLng =
        isValidLatLng(
          lat,
          lng
        );

      let latLng = null;

      if (
        hasValidUTM
      ) {
        latLng =
          utmToLatLng(
            easting,
            northing,
            epsg
          );
      }

      if (
        !latLng &&
        hasValidLatLng
      ) {
        latLng = [
          lat,
          lng,
        ];
      }

      if (!latLng) {
        console.warn(
          `Ignoring invalid control point row ${
            index + 1
          }:`,
          row
        );

        return;
      }

      points.push({
        station:
          station ||
          `Point ${
            points.length + 1
          }`,

        easting,

        northing,

        elevation:
          cleanValue(
            elevation
          ),

        epsg,

        latLng,

        __latLng:
          latLng,

        raw: row,
      });
    }
  );

  console.log(
    `Control CSV parsed: ${points.length} valid points`
  );

  return points;
}

/* =========================================================
   TRIG / BM CSV
   ROBUST VERSION
========================================================= */

function parseTrigCSV(
  text
) {
  const parsed =
    parseCSVWithDetectedHeader(
      text,
      [
        "Station Name",
        "Station",
        "Station Ref.",
        "Station Ref",
        "Point Name",
        "Point",
        "Latitude",
        "Longitude",
        "Easting",
        "Northing",
        "Elevation",
        "India MSL",
        "MSL",
        "Type",
        "Remarks",
      ]
    );

  const rows =
    parsed.rows || [];

  console.log(
    "Trig/BM detected fields:",
    parsed.fields
  );

  console.log(
    "Trig/BM raw rows:",
    rows
  );

  const points = [];

  rows.forEach(
    (row, index) => {
      const name =
        cleanValue(
          firstExisting(
            row,
            [
              "Station Name",
              "Station",
              "Point Name",
              "Point",
              "Name",
              "ID",
              "Point ID",
              "Trig Point",
              "Trig Name",
              "BM Name",
            ]
          )
        );

      const stationRef =
        cleanValue(
          firstExisting(
            row,
            [
              "Station Ref.",
              "Station Ref",
              "Station Reference",
              "Station No",
              "Station Number",
              "Ref.",
              "Ref",
              "Reference",
            ]
          )
        );

      const lat =
        numberValue(
          firstExisting(
            row,
            [
              "Latitude",
              "Latitude N",
              "Lat",
              "Lat N",
              "Latitude (N)",
            ]
          )
        );

      const lng =
        numberValue(
          firstExisting(
            row,
            [
              "Longitude",
              "Longitude E",
              "Long",
              "Lon",
              "Lng",
              "Long E",
              "Longitude (E)",
            ]
          )
        );

      const easting =
        numberValue(
          firstExisting(
            row,
            [
              "Easting",
              "UTM Easting",
              "UTM_Easting",
              "UTM E",
              "East",
              "X",
            ]
          )
        );

      const northing =
        numberValue(
          firstExisting(
            row,
            [
              "Northing",
              "UTM Northing",
              "UTM_Northing",
              "UTM N",
              "North",
              "Y",
            ]
          )
        );

      const elevation =
        firstExisting(
          row,
          [
            "India MSL",
            "India MSL (m)",
            "MSL",
            "MSL Elevation",
            "Elevation",
            "Elev",
            "RL",
            "Height",
            "Z",
            "Reduced Level",
            "Reduced Level (m)",
          ]
        );

      const remarks =
        cleanValue(
          firstExisting(
            row,
            [
              "Remarks",
              "Remark",
              "Description",
              "Comment",
              "Comments",
            ]
          )
        );

      const explicitType =
        cleanValue(
          firstExisting(
            row,
            [
              "Type",
              "Point Type",
              "Category",
              "Class",
              "Classification",
            ]
          )
        );

      const classificationText =
        [
          explicitType,
          stationRef,
          name,
          remarks,
        ]
          .join(" ")
          .toLowerCase();

      const type =
        /\bbm\b|benchmark|bench mark/.test(
          classificationText
        )
          ? "BM"
          : "TRIG";

      let latLng = null;

      /* ---------------------------------------------
         FIRST: LAT/LONG
      --------------------------------------------- */

      if (
        isValidLatLng(
          lat,
          lng
        )
      ) {
        latLng = [
          lat,
          lng,
        ];
      }

      /* ---------------------------------------------
         SECOND: UTM
      --------------------------------------------- */

      let usedEPSG = null;

      if (
        !latLng &&
        Number.isFinite(
          easting
        ) &&
        Number.isFinite(
          northing
        ) &&
        easting > 100000 &&
        northing > 100000
      ) {
        usedEPSG =
          detectUTMEPSG(
            row,
            null
          );

        if (usedEPSG) {
          latLng =
            utmToLatLng(
              easting,
              northing,
              usedEPSG
            );
        }
      }

      /* ---------------------------------------------
         INVALID ROW
      --------------------------------------------- */

      if (!latLng) {
        console.warn(
          `Ignoring invalid Trig/BM row ${
            index + 1
          }:`,
          row
        );

        return;
      }

      const finalName =
        name ||
        stationRef ||
        `${type}-${
          points.length + 1
        }`;

      points.push({
        name:
          finalName,

        stationRef,

        type,

        latitude:
          latLng[0],

        longitude:
          latLng[1],

        easting,

        northing,

        elevation:
          cleanValue(
            elevation
          ),

        remarks,

        epsg:
          usedEPSG || "",

        raw: row,

        __latLng:
          latLng,
      });
    }
  );

  console.log(
    `Successfully parsed ${points.length} Trig/BM points`
  );

  return points;
}

/* =========================================================
   KML
========================================================= */

function kmlTextToGeoJSON(
  text
) {
  const parser =
    new DOMParser();

  const xml =
    parser.parseFromString(
      text,
      "text/xml"
    );

  const errorNode =
    xml.querySelector(
      "parsererror"
    );

  if (errorNode) {
    throw new Error(
      "Invalid KML file."
    );
  }

  return kml(xml);
}

/* =========================================================
   ROBUST CROSS-SECTION KML PARSER
========================================================= */

function elementsByLocalName(
  root,
  wantedName
) {
  const result = [];

  if (!root) {
    return result;
  }

  const all =
    root.getElementsByTagName
      ? root.getElementsByTagName("*")
      : [];

  for (
    let i = 0;
    i < all.length;
    i += 1
  ) {
    const element =
      all[i];

    if (
      String(
        element.localName ||
          element.tagName
      ).toLowerCase() ===
      String(
        wantedName
      ).toLowerCase()
    ) {
      result.push(
        element
      );
    }
  }

  return result;
}

function firstElementByLocalName(
  root,
  wantedName
) {
  return (
    elementsByLocalName(
      root,
      wantedName
    )[0] || null
  );
}

function parseKmlLineCoordinates(
  coordinatesText
) {
  const coordinates = [];

  const tokens =
    String(
      coordinatesText || ""
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  tokens.forEach(
    (token) => {
      const parts =
        token.split(",");

      const longitude =
        Number(
          parts[0]
        );

      const latitude =
        Number(
          parts[1]
        );

      if (
        Number.isFinite(
          latitude
        ) &&
        Number.isFinite(
          longitude
        ) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
      ) {
        coordinates.push([
          latitude,
          longitude,
        ]);
      }
    }
  );

  return coordinates;
}

function parseGxTrackCoordinates(
  trackElement
) {
  const coordinates = [];

  elementsByLocalName(
    trackElement,
    "coord"
  ).forEach(
    (coordElement) => {
      const parts =
        String(
          coordElement.textContent ||
            ""
        )
          .trim()
          .split(/\s+/)
          .filter(Boolean);

      const longitude =
        Number(
          parts[0]
        );

      const latitude =
        Number(
          parts[1]
        );

      if (
        Number.isFinite(
          latitude
        ) &&
        Number.isFinite(
          longitude
        ) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
      ) {
        coordinates.push([
          latitude,
          longitude,
        ]);
      }
    }
  );

  return coordinates;
}

function parseCrossSectionsKML(
  text
) {
  const parser =
    new DOMParser();

  const xml =
    parser.parseFromString(
      text,
      "text/xml"
    );

  const errorNode =
    xml.querySelector(
      "parsererror"
    );

  if (errorNode) {
    throw new Error(
      "Invalid cross-section KML/XML file."
    );
  }

  const placemarks =
    elementsByLocalName(
      xml,
      "Placemark"
    );

  const features = [];

  const processPlacemark = (
    placemark,
    fallbackIndex
  ) => {
    const nameElement =
      firstElementByLocalName(
        placemark,
        "name"
      );

    const name =
      String(
        nameElement?.textContent ||
          ""
      ).trim() ||
      `Cross Section ${
        fallbackIndex + 1
      }`;

    const lineParts = [];

    elementsByLocalName(
      placemark,
      "LineString"
    ).forEach(
      (lineString) => {
        const coordinatesElement =
          firstElementByLocalName(
            lineString,
            "coordinates"
          );

        const coordinates =
          parseKmlLineCoordinates(
            coordinatesElement?.textContent ||
              ""
          );

        if (
          coordinates.length >= 2
        ) {
          lineParts.push(
            coordinates
          );
        }
      }
    );

    elementsByLocalName(
      placemark,
      "Track"
    ).forEach(
      (track) => {
        const coordinates =
          parseGxTrackCoordinates(
            track
          );

        if (
          coordinates.length >= 2
        ) {
          lineParts.push(
            coordinates
          );
        }
      }
    );

    if (
      lineParts.length === 1
    ) {
      features.push({
        type: "Feature",

        properties: {
          name,
        },

        geometry: {
          type: "LineString",

          coordinates:
            lineParts[0].map(
              ([lat, lng]) => [
                lng,
                lat,
              ]
            ),
        },
      });
    } else if (
      lineParts.length > 1
    ) {
      features.push({
        type: "Feature",

        properties: {
          name,
        },

        geometry: {
          type: "MultiLineString",

          coordinates:
            lineParts.map(
              (line) =>
                line.map(
                  ([lat, lng]) => [
                    lng,
                    lat,
                  ]
                )
            ),
        },
      });
    }
  };

  if (
    placemarks.length > 0
  ) {
    placemarks.forEach(
      (
        placemark,
        index
      ) =>
        processPlacemark(
          placemark,
          index
        )
    );
  } else {
    const lineStrings =
      elementsByLocalName(
        xml,
        "LineString"
      );

    lineStrings.forEach(
      (
        lineString,
        index
      ) => {
        const coordinatesElement =
          firstElementByLocalName(
            lineString,
            "coordinates"
          );

        const coordinates =
          parseKmlLineCoordinates(
            coordinatesElement?.textContent ||
              ""
          );

        if (
          coordinates.length >= 2
        ) {
          features.push({
            type: "Feature",

            properties: {
              name: `Cross Section ${
                index + 1
              }`,
            },

            geometry: {
              type: "LineString",

              coordinates:
                coordinates.map(
                  ([lat, lng]) => [
                    lng,
                    lat,
                  ]
                ),
            },
          });
        }
      }
    );
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(
  value
) {
  return String(
    value === null ||
      value === undefined
      ? ""
      : value
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

/* =========================================================
   PHOTO
========================================================= */

function stationPhotoUrl(
  folder,
  station
) {
  if (
    !folder ||
    !station
  ) {
    return "";
  }

  return publicUrl(
    `${folder}${String(
      station
    ).trim()}.jpg`
  );
}

/* =========================================================
   CONTROL ICON
========================================================= */

function controlIcon(
  station
) {
  return L.divIcon({
    className:
      "marker-wrap",

    html: `
      <div
        class="marker cp"
        style="
          min-width:24px;
          min-height:24px;
          padding:4px 7px;
          display:flex;
          align-items:center;
          justify-content:center;
          background:#2563eb;
          color:#ffffff;
          border:2px solid #ffffff;
          border-radius:50%;
          box-shadow:0 2px 7px rgba(0,0,0,.45);
          font-size:10px;
          font-weight:700;
          white-space:nowrap;
        "
      >
        ${escapeHtml(
          station
        )}
      </div>
    `,

    iconSize: [
      32,
      32,
    ],

    iconAnchor: [
      16,
      16,
    ],

    popupAnchor: [
      0,
      -16,
    ],
  });
}

/* =========================================================
   TRIG ICON
========================================================= */

function trigIcon(
  name
) {
  return L.divIcon({
    className:
      "marker-wrap",

    html: `
      <div
        class="marker trig"
        style="
          min-width:28px;
          min-height:28px;
          padding:4px 6px;
          display:flex;
          align-items:center;
          justify-content:center;
          background:#dc2626;
          color:#ffffff;
          border:2px solid #ffffff;
          border-radius:50%;
          box-shadow:0 2px 8px rgba(0,0,0,.55);
          font-size:10px;
          font-weight:800;
          white-space:nowrap;
        "
      >
        ${escapeHtml(
          name
        )}
      </div>
    `,

    iconSize: [
      32,
      32,
    ],

    iconAnchor: [
      16,
      30,
    ],

    popupAnchor: [
      0,
      -28,
    ],
  });
}

/* =========================================================
   BM ICON
========================================================= */

function bmIcon(
  name
) {
  return L.divIcon({
    className:
      "marker-wrap",

    html: `
      <div
        class="marker bm"
        style="
          min-width:28px;
          min-height:28px;
          padding:4px 6px;
          display:flex;
          align-items:center;
          justify-content:center;
          background:#16a34a;
          color:#ffffff;
          border:2px solid #ffffff;
          border-radius:5px;
          box-shadow:0 2px 8px rgba(0,0,0,.55);
          font-size:10px;
          font-weight:800;
          white-space:nowrap;
        "
      >
        ${escapeHtml(
          name
        )}
      </div>
    `,

    iconSize: [
      32,
      32,
    ],

    iconAnchor: [
      16,
      16,
    ],

    popupAnchor: [
      0,
      -16,
    ],
  });
}

/* =========================================================
   CONTROL POPUP
========================================================= */

function controlPopup(
  point,
  project
) {
  const station =
    point.station ||
    "Control Point";

  const photo =
    stationPhotoUrl(
      project.photoFolder,
      station
    );

  const rows = [];

  rows.push(`
    <div class="prow">
      <b>Station</b>
      <span>${escapeHtml(
        station
      )}</span>
    </div>
  `);

  if (
    Number.isFinite(
      point.easting
    )
  ) {
    rows.push(`
      <div class="prow">
        <b>Easting</b>
        <span>${escapeHtml(
          point.easting
        )}</span>
      </div>
    `);
  }

  if (
    Number.isFinite(
      point.northing
    )
  ) {
    rows.push(`
      <div class="prow">
        <b>Northing</b>
        <span>${escapeHtml(
          point.northing
        )}</span>
      </div>
    `);
  }

  if (
    point.elevation !== ""
  ) {
    rows.push(`
      <div class="prow">
        <b>Elevation</b>
        <span>${escapeHtml(
          point.elevation
        )}</span>
      </div>
    `);
  }

  rows.push(`
    <div class="prow">
      <b>CRS</b>
      <span>${escapeHtml(
        point.epsg
      )}</span>
    </div>
  `);

  const allAttributes =
    Object.entries(
      point.raw || {}
    );

  const shownKeys =
    new Set([
      "station",
      "station name",
      "point",
      "point name",
      "name",
      "id",
      "point id",
      "control point",
      "control point name",
      "ref",
      "reference",
      "easting",
      "e",
      "utm easting",
      "utm easting",
      "utm_easting",
      "x",
      "northing",
      "n",
      "utm northing",
      "utm_northing",
      "y",
      "elevation",
      "elev",
      "rl",
      "height",
      "z",
      "reduced level",
    ]);

  const extraRows =
    allAttributes
      .filter(
        ([key]) =>
          !shownKeys.has(
            normalizeHeader(
              key
            )
          )
      )
      .filter(
        ([, value]) =>
          cleanValue(
            value
          ) !== ""
      )
      .slice(0, 20)
      .map(
        ([key, value]) => `
          <div class="prow">
            <b>${escapeHtml(
              key
            )}</b>
            <span>${escapeHtml(
              value
            )}</span>
          </div>
        `
      )
      .join("");

  let photoHtml = `
    <div class="photo-wrap">
      <div class="missing">
        No photo available
      </div>
    </div>
  `;

  if (photo) {
    photoHtml = `
      <div class="photo-wrap">
        <img
          class="photo"
          src="${photo}"
          alt="${escapeHtml(
            station
          )}"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
          onclick="window.open(this.src, '_blank')"
        />

        <div
          class="missing"
          style="display:none"
        >
          Photo not found
        </div>
      </div>
    `;
  }

  return `
    <div class="popup">

      <h3>
        ${escapeHtml(
          station
        )}
      </h3>

      <div
        style="
          font-size:8px;
          color:#667085;
          margin-bottom:7px;
        "
      >
        ${escapeHtml(
          project.name
        )}
      </div>

      <div class="attrs">
        ${rows.join("")}
        ${extraRows}
      </div>

      ${photoHtml}

    </div>
  `;
}

/* =========================================================
   TRIG POPUP
========================================================= */

function trigPopup(
  point
) {
  const rows = [];

  rows.push(`
    <div class="prow">
      <b>Name</b>
      <span>${escapeHtml(
        point.name
      )}</span>
    </div>
  `);

  rows.push(`
    <div class="prow">
      <b>Type</b>
      <span>${escapeHtml(
        point.type
      )}</span>
    </div>
  `);

  if (
    point.stationRef
  ) {
    rows.push(`
      <div class="prow">
        <b>Station Ref.</b>
        <span>${escapeHtml(
          point.stationRef
        )}</span>
      </div>
    `);
  }

  if (
    Number.isFinite(
      point.latitude
    )
  ) {
    rows.push(`
      <div class="prow">
        <b>Latitude</b>
        <span>${escapeHtml(
          point.latitude
        )}</span>
      </div>
    `);
  }

  if (
    Number.isFinite(
      point.longitude
    )
  ) {
    rows.push(`
      <div class="prow">
        <b>Longitude</b>
        <span>${escapeHtml(
          point.longitude
        )}</span>
      </div>
    `);
  }

  if (
    Number.isFinite(
      point.easting
    )
  ) {
    rows.push(`
      <div class="prow">
        <b>Easting</b>
        <span>${escapeHtml(
          point.easting
        )}</span>
      </div>
    `);
  }

  if (
    Number.isFinite(
      point.northing
    )
  ) {
    rows.push(`
      <div class="prow">
        <b>Northing</b>
        <span>${escapeHtml(
          point.northing
        )}</span>
      </div>
    `);
  }

  if (
    point.epsg
  ) {
    rows.push(`
      <div class="prow">
        <b>CRS</b>
        <span>${escapeHtml(
          point.epsg
        )}</span>
      </div>
    `);
  }

  if (
    point.elevation !== ""
  ) {
    rows.push(`
      <div class="prow">
        <b>Elevation</b>
        <span>${escapeHtml(
          point.elevation
        )}</span>
      </div>
    `);
  }

  if (
    point.remarks
  ) {
    rows.push(`
      <div class="prow">
        <b>Remarks</b>
        <span>${escapeHtml(
          point.remarks
        )}</span>
      </div>
    `);
  }

  return `
    <div class="popup">

      <h3>
        ${escapeHtml(
          point.name
        )}
      </h3>

      <div class="attrs">
        ${rows.join("")}
      </div>

    </div>
  `;
}

/* =========================================================
   LAYER GROUP BOUNDS
========================================================= */

function boundsFromLayerGroup(
  group
) {
  const bounds =
    L.latLngBounds([]);

  if (!group) {
    return bounds;
  }

  group.eachLayer(
    (layer) => {
      try {
        if (
          layer &&
          typeof layer.getBounds ===
            "function"
        ) {
          const layerBounds =
            layer.getBounds();

          if (
            layerBounds &&
            layerBounds.isValid()
          ) {
            bounds.extend(
              layerBounds
            );
          }
        } else if (
          layer &&
          typeof layer.getLatLng ===
            "function"
        ) {
          const latLng =
            layer.getLatLng();

          if (latLng) {
            bounds.extend(
              latLng
            );
          }
        }
      } catch (error) {
        console.warn(
          "Could not calculate layer bounds:",
          error
        );
      }
    }
  );

  return bounds;
}

/* =========================================================
   LOCAL KML / SHP
========================================================= */

function fileToGeoJSON(
  file
) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload =
        async () => {
          try {
            const buffer =
              reader.result;

            const name =
              file.name.toLowerCase();

            if (
              name.endsWith(
                ".kml"
              )
            ) {
              const text =
                new TextDecoder().decode(
                  buffer
                );

              resolve(
                kmlTextToGeoJSON(
                  text
                )
              );

              return;
            }

            if (
              name.endsWith(
                ".kmz"
              )
            ) {
              throw new Error(
                "KMZ is not supported. Please upload KML."
              );
            }

            if (
              name.endsWith(
                ".zip"
              )
            ) {
              const geojson =
                await shp(
                  buffer
                );

              resolve(
                geojson
              );

              return;
            }

            throw new Error(
              "Please upload a KML or SHP ZIP file."
            );
          } catch (error) {
            reject(error);
          }
        };

      reader.onerror =
        () =>
          reject(
            new Error(
              "Could not read the file."
            )
          );

      reader.readAsArrayBuffer(
        file
      );
    }
  );
}

/* =========================================================
   MAIN APP
========================================================= */

function App() {
  const mapRef =
    useRef(null);

  const boundaryGroupRef =
    useRef(null);

  const crossGroupRef =
    useRef(null);

  const controlGroupRef =
    useRef(null);

  const trigGroupRef =
    useRef(null);

  const trigPointsRef =
    useRef([]);

  const trigLoadingRef =
    useRef(false);

  const uploadGroupRef =
    useRef(null);

  const layerControlRef =
    useRef(null);

  const [
    selectedProject,
    setSelectedProject,
  ] = useState(null);

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    controlPoints,
    setControlPoints,
  ] = useState([]);

  const [
    trigPoints,
    setTrigPoints,
  ] = useState([]);

  const [
    boundaryCount,
    setBoundaryCount,
  ] = useState(0);

  const [
    crossCount,
    setCrossCount,
  ] = useState(0);

  const [
    uploads,
    setUploads,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    status,
    setStatus,
  ] = useState("Ready");

  const [
    error,
    setError,
  ] = useState("");

  const filteredProjects =
    useMemo(() => {
      const text =
        search
          .toLowerCase()
          .trim();

      if (!text) {
        return PROJECTS;
      }

      return PROJECTS.filter(
        (project) =>
          project.name
            .toLowerCase()
            .includes(text) ||
          project.code
            .toLowerCase()
            .includes(text) ||
          project.location
            .toLowerCase()
            .includes(text)
      );
    }, [search]);

  /* =======================================================
     INITIALIZE MAP
  ======================================================= */

  useEffect(() => {
    if (mapRef.current) {
      return;
    }

    const map =
      L.map("map", {
        zoomControl: true,
        preferCanvas: true,
      });

    mapRef.current =
      map;

    const boundaryPane =
      map.createPane(
        "boundaryPane"
      );

    boundaryPane.style.zIndex =
      200;

    boundaryPane.style.pointerEvents =
      "none";

    const crossPane =
      map.createPane(
        "crossPane"
      );

    crossPane.style.zIndex =
      450;

    const trigPane =
      map.createPane(
        "trigPane"
      );

    trigPane.style.zIndex =
      550;

    const controlPane =
      map.createPane(
        "controlPane"
      );

    controlPane.style.zIndex =
      650;

    const uploadPane =
      map.createPane(
        "uploadPane"
      );

    uploadPane.style.zIndex =
      700;

    const googleSatellite =
      L.tileLayer(
        "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        {
          maxZoom: 21,
          maxNativeZoom: 20,
          attribution:
            "&copy; Google",
        }
      );

    const googleStreet =
      L.tileLayer(
        "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
        {
          maxZoom: 21,
          maxNativeZoom: 20,
          attribution:
            "&copy; Google",
        }
      );

    googleSatellite.addTo(
      map
    );

    const boundaryGroup =
      L.layerGroup().addTo(
        map
      );

    const crossGroup =
      L.layerGroup().addTo(
        map
      );

    const trigGroup =
      L.layerGroup().addTo(
        map
      );

    const controlGroup =
      L.layerGroup().addTo(
        map
      );

    const uploadGroup =
      L.layerGroup().addTo(
        map
      );

    boundaryGroupRef.current =
      boundaryGroup;

    crossGroupRef.current =
      crossGroup;

    trigGroupRef.current =
      trigGroup;

    controlGroupRef.current =
      controlGroup;

    uploadGroupRef.current =
      uploadGroup;

    layerControlRef.current =
      L.control
        .layers(
          {
            "Google Satellite":
              googleSatellite,

            "Google Street Map":
              googleStreet,
          },
          {
            "Survey Boundary":
              boundaryGroup,

            "Cross Sections":
              crossGroup,

            "Trig / BM":
              trigGroup,

            "Control Points":
              controlGroup,

            "Uploaded Data":
              uploadGroup,
          },
          {
            collapsed: false,
            position:
              "topright",
          }
        )
        .addTo(map);

    try {
      L.control
        .measure({
          position:
            "topleft",

          primaryLengthUnit:
            "kilometers",

          secondaryLengthUnit:
            "meters",

          primaryAreaUnit:
            "hectares",

          secondaryAreaUnit:
            "sqmeters",

          activeColor:
            "#3388ff",

          completedColor:
            "#3388ff",

          captureZIndex:
            10000,
        })
        .addTo(map);
    } catch (
      measurementError
    ) {
      console.warn(
        "Measurement tool could not initialize:",
        measurementError
      );
    }

    map.setView(
      [
        28.3949,
        84.124,
      ],
      7
    );

    setTimeout(() => {
      map.invalidateSize();
    }, 300);

    return () => {
      map.remove();

      mapRef.current =
        null;

      boundaryGroupRef.current =
        null;

      crossGroupRef.current =
        null;

      controlGroupRef.current =
        null;

      trigGroupRef.current =
        null;

      uploadGroupRef.current =
        null;
    };
  }, []);

  /* =======================================================
     LOAD TRIG / BM
  ======================================================= */

  const loadTrigPoints =
    useCallback(
      async () => {
        if (
          trigLoadingRef.current
        ) {
          console.log(
            "Trig/BM loading already in progress."
          );

          return trigPointsRef.current;
        }

        trigLoadingRef.current =
          true;

        try {
          setStatus(
            "Loading common Trig / BM data..."
          );

          setError("");

          const url =
            publicUrl(
              COMMON_TRIG_PATH
            );

          console.log(
            "======================================"
          );

          console.log(
            "Loading Trig/BM CSV:"
          );

          console.log(
            url
          );

          const response =
            await fetch(
              url,
              {
                cache:
                  "no-store",
              }
            );

          console.log(
            "Trig/BM HTTP status:",
            response.status
          );

          console.log(
            "Trig/BM response OK:",
            response.ok
          );

          if (!response.ok) {
            throw new Error(
              `Trig/BM CSV request failed (${response.status})`
            );
          }

          const text =
            await response.text();

          console.log(
            "Trig/BM CSV length:",
            text.length
          );

          console.log(
            "Trig/BM CSV first 1000 characters:"
          );

          console.log(
            text.slice(
              0,
              1000
            )
          );

          if (
            !text.trim()
          ) {
            throw new Error(
              "The Trig/BM CSV is empty."
            );
          }

          const points =
            parseTrigCSV(
              text
            );

          if (
            points.length ===
            0
          ) {
            throw new Error(
              "CSV was downloaded successfully, but 0 valid Trig/BM coordinates were found. Check the CSV header and coordinate columns."
            );
          }

          trigPointsRef.current =
            points;

          setTrigPoints(
            points
          );

          const group =
            trigGroupRef.current;

          if (!group) {
            throw new Error(
              "Trig/BM Leaflet layer group is not initialized."
            );
          }

          group.clearLayers();

          points.forEach(
            (point) => {
              if (
                !point.__latLng
              ) {
                return;
              }

              const marker =
                L.marker(
                  point.__latLng,
                  {
                    icon:
                      point.type ===
                      "BM"
                        ? bmIcon(
                            point.name
                          )
                        : trigIcon(
                            point.name
                          ),

                    pane:
                      "trigPane",

                    riseOnHover:
                      true,
                  }
                );

              marker.bindPopup(
                trigPopup(
                  point
                ),
                {
                  maxWidth: 340,
                  minWidth: 230,
                }
              );

              marker.addTo(
                group
              );
            }
          );

          setStatus(
            `${points.length} common Trig / BM points loaded`
          );

          console.log(
            "Successfully displayed Trig/BM points:",
            points
          );

          console.log(
            "======================================"
          );

          return points;
        } catch (err) {
          console.error(
            "Trig/BM loading failed:",
            err
          );

          trigPointsRef.current =
            [];

          setTrigPoints(
            []
          );

          setStatus(
            "Trig / BM data unavailable"
          );

          setError(
            `Trig/BM error: ${
              err?.message ||
              "Unknown error"
            }`
          );

          return [];
        } finally {
          trigLoadingRef.current =
            false;
        }
      },
      []
    );

  /* =======================================================
     LOAD INITIAL OVERVIEW
  ======================================================= */

  const showOverview =
    useCallback(
      async () => {
        if (
          !mapRef.current
        ) {
          return;
        }

        const map =
          mapRef.current;

        const boundaryGroup =
          boundaryGroupRef.current;

        const crossGroup =
          crossGroupRef.current;

        const controlGroup =
          controlGroupRef.current;

        const trigGroup =
          trigGroupRef.current;

        if (
          !boundaryGroup ||
          !crossGroup ||
          !controlGroup ||
          !trigGroup
        ) {
          return;
        }

        setSelectedProject(
          null
        );

        setError("");

        setStatus(
          "Loading survey overview..."
        );

        boundaryGroup.clearLayers();

        crossGroup.clearLayers();

        controlGroup.clearLayers();

        setControlPoints(
          []
        );

        setBoundaryCount(
          0
        );

        setCrossCount(
          0
        );

        /* -----------------------------------------
           LOAD COMMON TRIG
        ----------------------------------------- */

        if (
          trigPointsRef.current.length ===
          0
        ) {
          await loadTrigPoints();
        }

        /* -----------------------------------------
           LOAD BOUNDARIES
        ----------------------------------------- */

        const overviewBounds =
          L.latLngBounds([]);

        let totalBoundaries =
          0;

        for (
          const project of PROJECTS
        ) {
          if (
            !project.boundaryPath
          ) {
            continue;
          }

          try {
            const url =
              publicUrl(
                project.boundaryPath
              );

            console.log(
              `Loading boundary ${project.code}:`,
              url
            );

            const response =
              await fetch(
                url,
                {
                  cache:
                    "no-store",
                }
              );

            if (
              !response.ok
            ) {
              throw new Error(
                `Boundary request failed (${response.status})`
              );
            }

            const text =
              await response.text();

            const geojson =
              kmlTextToGeoJSON(
                text
              );

            const layer =
              L.geoJSON(
                geojson,
                {
                  pane:
                    "boundaryPane",

                  interactive:
                    false,

                  style: {
                    color:
                      "#f59e0b",

                    weight: 3,

                    opacity:
                      0.9,

                    fillColor:
                      "#f59e0b",

                    fillOpacity:
                      0.08,
                  },
                }
              );

            layer.addTo(
              boundaryGroup
            );

            const bounds =
              layer.getBounds();

            if (
              bounds.isValid()
            ) {
              overviewBounds.extend(
                bounds
              );
            }

            totalBoundaries++;
          } catch (err) {
            console.error(
              `Boundary failed for ${project.code}:`,
              err
            );
          }
        }

        /* -----------------------------------------
           TRIG / BM BOUNDS
        ----------------------------------------- */

        trigPointsRef.current.forEach(
          (point) => {
            if (
              point.__latLng
            ) {
              overviewBounds.extend(
                point.__latLng
              );
            }
          }
        );

        /* -----------------------------------------
           FIT EVERYTHING
        ----------------------------------------- */

        if (
          overviewBounds.isValid()
        ) {
          map.fitBounds(
            overviewBounds,
            {
              padding: [
                60,
                60,
              ],

              maxZoom: 17,

              animate: false,
            }
          );
        } else {
          map.setView(
            [
              28.3949,
              84.124,
            ],
            7
          );
        }

        setBoundaryCount(
          totalBoundaries
        );

        setStatus(
          "Overview ready — survey boundary and common Trig/BM data loaded."
        );

        setTimeout(() => {
          map.invalidateSize();
        }, 200);
      },
      [
        loadTrigPoints,
      ]
    );

  /* =======================================================
     INITIAL OVERVIEW CALL
  ======================================================= */

  useEffect(() => {
    const timer =
      setTimeout(() => {
        showOverview();
      }, 500);

    return () =>
      clearTimeout(timer);
  }, [
    showOverview,
  ]);

  /* =======================================================
     LOAD PROJECT
  ======================================================= */

  const loadProject =
    useCallback(
      async (
        project
      ) => {
        if (
          !mapRef.current
        ) {
          return;
        }

        const map =
          mapRef.current;

        const boundaryGroup =
          boundaryGroupRef.current;

        const crossGroup =
          crossGroupRef.current;

        const controlGroup =
          controlGroupRef.current;

        const trigGroup =
          trigGroupRef.current;

        if (
          !boundaryGroup ||
          !crossGroup ||
          !controlGroup ||
          !trigGroup
        ) {
          setError(
            "Map layers are not initialized."
          );

          return;
        }

        setLoading(
          true
        );

        setError("");

        setStatus(
          `Loading ${project.code}...`
        );

        boundaryGroup.clearLayers();

        crossGroup.clearLayers();

        controlGroup.clearLayers();

        setControlPoints(
          []
        );

        setBoundaryCount(
          0
        );

        setCrossCount(
          0
        );

        /* -----------------------------------------
           LOAD BOUNDARY
        ----------------------------------------- */

        if (
          project.boundaryPath
        ) {
          try {
            const url =
              publicUrl(
                project.boundaryPath
              );

            const response =
              await fetch(
                url,
                {
                  cache:
                    "no-store",
                }
              );

            if (
              !response.ok
            ) {
              throw new Error(
                `Boundary request failed (${response.status})`
              );
            }

            const text =
              await response.text();

            const geojson =
              kmlTextToGeoJSON(
                text
              );

            const boundaryLayer =
              L.geoJSON(
                geojson,
                {
                  pane:
                    "boundaryPane",

                  interactive:
                    false,

                  style: {
                    color:
                      "#f59e0b",

                    weight: 3,

                    opacity:
                      0.95,

                    fillColor:
                      "#f59e0b",

                    fillOpacity:
                      0.08,
                  },
                }
              );

            boundaryLayer.addTo(
              boundaryGroup
            );

            setBoundaryCount(
              Array.isArray(
                geojson.features
              )
                ? geojson.features.length
                : 1
            );
          } catch (
            boundaryError
          ) {
            console.error(
              "Boundary loading failed:",
              boundaryError
            );

            setError(
              `Boundary could not be loaded: ${boundaryError.message}`
            );
          }
        }

        /* -----------------------------------------
           LOAD CROSS SECTIONS
        ----------------------------------------- */

        if (
          project.crossPath
        ) {
          try {
            const url =
              publicUrl(
                project.crossPath
              );

            console.log(
              "Loading cross sections:",
              url
            );

            const response =
              await fetch(
                url,
                {
                  cache:
                    "no-store",
                }
              );

            if (
              !response.ok
            ) {
              throw new Error(
                `Cross section request failed (${response.status})`
              );
            }

            const text =
              await response.text();

            if (
              !text.trim()
            ) {
              throw new Error(
                "Cross-section KML is empty."
              );
            }

            const geojson =
              parseCrossSectionsKML(
                text
              );

            console.log(
              `Cross sections parsed: ${geojson.features.length}`
            );

            if (
              geojson.features.length ===
              0
            ) {
              throw new Error(
                "KML was loaded, but no LineString/MultiLineString cross-section geometry was found."
              );
            }

            const crossLayer =
              L.geoJSON(
                geojson,
                {
                  pane:
                    "crossPane",

                  interactive:
                    true,

                  style: {
                    color:
                      "#ff0000",

                    weight: 4,

                    opacity:
                      1,

                    lineCap:
                      "round",

                    lineJoin:
                      "round",
                  },

                  onEachFeature:
                    (
                      feature,
                      layer
                    ) => {
                      const name =
                        feature?.properties?.name ||
                        "Cross Section";

                      layer.bindPopup(
                        `<b>${escapeHtml(
                          name
                        )}</b>`
                      );
                    },
                }
              );

            crossLayer.addTo(
              crossGroup
            );

            setCrossCount(
              geojson.features.length
            );
          } catch (
            crossError
          ) {
            console.error(
              "Cross section loading failed:",
              crossError
            );

            setCrossCount(
              0
            );

            setError(
              `Cross sections could not be loaded: ${crossError.message}`
            );
          }
        }

        /* -----------------------------------------
           LOAD CONTROL POINTS
        ----------------------------------------- */

        let validControls =
          [];

        try {
          const url =
            publicUrl(
              project.controlPath
            );

          console.log(
            `Loading control CSV ${project.code}:`,
            url
          );

          const response =
            await fetch(
              url,
              {
                cache:
                  "no-store",
              }
            );

          if (
            !response.ok
          ) {
            throw new Error(
              `Control CSV request failed (${response.status})`
            );
          }

          const text =
            await response.text();

          validControls =
            parseControlCSV(
              text,
              project.epsg
            );

          setControlPoints(
            validControls
          );

          validControls.forEach(
            (point) => {
              if (
                !point.__latLng
              ) {
                return;
              }

              const marker =
                L.marker(
                  point.__latLng,
                  {
                    icon:
                      controlIcon(
                        point.station
                      ),

                    pane:
                      "controlPane",

                    riseOnHover:
                      true,
                  }
                );

              marker.bindPopup(
                controlPopup(
                  point,
                  project
                ),
                {
                  maxWidth: 360,

                  minWidth: 230,

                  autoPan:
                    true,
                }
              );

              marker.addTo(
                controlGroup
              );
            }
          );

          console.log(
            `${validControls.length} valid control points loaded`
          );
        } catch (
          controlError
        ) {
          console.error(
            "Control point loading failed:",
            controlError
          );

          setError(
            `Control points could not be loaded: ${controlError.message}`
          );
        }

        /* -----------------------------------------
           MAKE SURE TRIG IS LOADED
        ----------------------------------------- */

        if (
          trigPointsRef.current.length ===
          0
        ) {
          await loadTrigPoints();
        }

        /* -----------------------------------------
           FINAL BOUNDS
        ----------------------------------------- */

        const finalBounds =
          L.latLngBounds([]);

        const boundaryBounds =
          boundsFromLayerGroup(
            boundaryGroup
          );

        const crossBounds =
          boundsFromLayerGroup(
            crossGroup
          );

        const trigBounds =
          boundsFromLayerGroup(
            trigGroup
          );

        if (
          boundaryBounds.isValid()
        ) {
          finalBounds.extend(
            boundaryBounds
          );
        }

        if (
          crossBounds.isValid()
        ) {
          finalBounds.extend(
            crossBounds
          );
        }

        if (
          trigBounds.isValid()
        ) {
          finalBounds.extend(
            trigBounds
          );
        }

        validControls.forEach(
          (point) => {
            if (
              point.__latLng
            ) {
              finalBounds.extend(
                point.__latLng
              );
            }
          }
        );

        if (
          finalBounds.isValid()
        ) {
          map.fitBounds(
            finalBounds,
            {
              padding: [
                50,
                50,
              ],

              maxZoom: 17,

              animate: false,
            }
          );
        }

        setTimeout(() => {
          map.invalidateSize();

          if (
            finalBounds.isValid()
          ) {
            map.fitBounds(
              finalBounds,
              {
                padding: [
                  50,
                  50,
                ],

                maxZoom: 17,

                animate: false,
              }
            );
          }
        }, 300);

        setStatus(
          `${project.code}: ${validControls.length} control points loaded`
        );

        setLoading(
          false
        );
      },
      [
        loadTrigPoints,
      ]
    );

  /* =======================================================
     OPEN PROJECT
  ======================================================= */

  const openProject =
    useCallback(
      async (
        project
      ) => {
        setSelectedProject(
          project
        );

        await loadProject(
          project
        );
      },
      [
        loadProject,
      ]
    );

  /* =======================================================
     RETURN TO OVERVIEW
  ======================================================= */

  const returnToOverview =
    useCallback(
      async () => {
        await showOverview();
      },
      [
        showOverview,
      ]
    );

  /* =======================================================
     UPLOAD LOCAL KML / SHP
  ======================================================= */

  const handleUpload =
    useCallback(
      async (
        event
      ) => {
        const files =
          Array.from(
            event.target.files || []
          );

        if (
          !files.length
        ) {
          return;
        }

        setError("");

        const uploadGroup =
          uploadGroupRef.current;

        if (!uploadGroup) {
          return;
        }

        for (
          const file of files
        ) {
          try {
            setStatus(
              `Reading ${file.name}...`
            );

            const geojson =
              await fileToGeoJSON(
                file
              );

            const layer =
              L.geoJSON(
                geojson,
                {
                  pane:
                    "uploadPane",

                  style: {
                    color:
                      "#2563eb",

                    weight: 3,

                    fillColor:
                      "#2563eb",

                    fillOpacity:
                      0.08,
                  },

                  pointToLayer:
                    (
                      feature,
                      latlng
                    ) =>
                      L.circleMarker(
                        latlng,
                        {
                          pane:
                            "uploadPane",

                          radius: 5,

                          color:
                            "#2563eb",

                          fillColor:
                            "#2563eb",

                          fillOpacity:
                            0.9,
                        }
                      ),
                }
              );

            layer.addTo(
              uploadGroup
            );

            const bounds =
              typeof layer.getBounds ===
              "function"
                ? layer.getBounds()
                : null;

            if (
              bounds &&
              bounds.isValid() &&
              mapRef.current
            ) {
              mapRef.current.fitBounds(
                bounds,
                {
                  padding: [
                    40,
                    40,
                  ],

                  maxZoom: 18,
                }
              );
            }

            setUploads(
              (
                previous
              ) => [
                ...previous,

                {
                  name:
                    file.name,

                  type:
                    file.name
                      .toLowerCase()
                      .endsWith(
                        ".kml"
                      )
                      ? "KML"
                      : "SHP",

                  layer,
                },
              ]
            );

            setStatus(
              `${file.name} loaded`
            );
          } catch (
            uploadError
          ) {
            console.error(
              uploadError
            );

            setError(
              `${file.name}: ${uploadError.message}`
            );
          }
        }

        event.target.value =
          "";
      },
      []
    );

  /* =======================================================
     ZOOM CONTROL POINT
  ======================================================= */

  function zoomToControl(
    point
  ) {
    if (
      !mapRef.current ||
      !point ||
      !point.__latLng
    ) {
      return;
    }

    mapRef.current.setView(
      point.__latLng,
      19,
      {
        animate: true,
      }
    );

    const group =
      controlGroupRef.current;

    if (!group) {
      return;
    }

    group.eachLayer(
      (layer) => {
        if (
          !layer ||
          typeof layer.getLatLng !==
            "function"
        ) {
          return;
        }

        const latLng =
          layer.getLatLng();

        if (
          latLng &&
          Math.abs(
            latLng.lat -
              point.__latLng[0]
          ) <
            0.0000001 &&
          Math.abs(
            latLng.lng -
              point.__latLng[1]
          ) <
            0.0000001
        ) {
          layer.openPopup();
        }
      }
    );
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="shell">

      {/* =================================================
          SIDEBAR
      ================================================= */}

      <aside className="side">

        <div className="brand">

          <div className="brand-icon">
            GIS
          </div>

          <div>
            <b>
              SURVEY WEBGIS
            </b>

            <small>
              Survey Archive & Project Overview
            </small>
          </div>

        </div>

        {selectedProject ? (
          <>
            <button
              className="back"
              onClick={
                returnToOverview
              }
            >
              ← All Projects
            </button>

            <div className="intro">

              <h2>
                {
                  selectedProject.name
                }
              </h2>

              <p>
                {
                  selectedProject.location
                }
                {" • "}
                {
                  selectedProject.year
                }
              </p>

            </div>

            <div className="summary">

              <b>
                {
                  selectedProject.code
                }
              </b>

              <span>
                Coordinate System:{" "}
                {
                  selectedProject.epsg
                }
              </span>

              <span>
                Control Points:{" "}
                {
                  controlPoints.length
                }
              </span>

              <span>
                Cross Sections:{" "}
                {
                  crossCount
                }
              </span>

              <span>
                Boundary:{" "}
                {boundaryCount
                  ? "Available"
                  : "Not available"}
              </span>

              <span>
                Common Trig / BM:{" "}
                {
                  trigPoints.length
                }
              </span>

              {loading && (
                <small>
                  Loading project data...
                </small>
              )}

            </div>

            {/* CONTROL POINTS */}

            <div className="section">

              <label>
                Control Points
              </label>

              {controlPoints.length ? (
                <div className="list">

                  {controlPoints.map(
                    (
                      point
                    ) => (
                      <button
                        key={
                          `${point.station}-${point.easting}-${point.northing}`
                        }
                        className="item"
                        onClick={() =>
                          zoomToControl(
                            point
                          )
                        }
                      >

                        <strong>
                          CP
                        </strong>

                        <span>

                          <b>
                            {
                              point.station
                            }
                          </b>

                          <small>
                            E:{" "}
                            {
                              point.easting
                            }
                            {" | "}
                            N:{" "}
                            {
                              point.northing
                            }
                          </small>

                        </span>

                      </button>
                    )
                  )}

                </div>
              ) : (
                <div className="empty">
                  No control points loaded.
                </div>
              )}

            </div>

            {/* UPLOAD */}

            <div className="upload">

              <b>
                Upload KML / SHP
              </b>

              <input
                id="project-file-upload"
                type="file"
                accept=".kml,.zip"
                multiple
                style={{
                  display:
                    "none",
                }}
                onChange={
                  handleUpload
                }
              />

              <label
                htmlFor="project-file-upload"
                className="upload-btn"
                style={{
                  display:
                    "block",

                  textAlign:
                    "center",

                  cursor:
                    "pointer",
                }}
              >
                + Upload KML / SHP
              </label>

              <small>
                KML files can be uploaded
                directly. For SHP, upload
                the complete shapefile as
                a ZIP containing .shp,
                .shx, .dbf and preferably
                .prj.
              </small>

              {uploads.length > 0 && (
                <div className="uploads">

                  {uploads.map(
                    (
                      upload,
                      index
                    ) => (
                      <div
                        className="upload-card"
                        key={`${upload.name}-${index}`}
                      >

                        <b>
                          {
                            upload.name
                          }
                        </b>

                        <small>
                          {
                            upload.type
                          } loaded
                        </small>

                        <button
                          onClick={() => {
                            upload.layer.remove();

                            setUploads(
                              (
                                previous
                              ) =>
                                previous.filter(
                                  (
                                    _,
                                    i
                                  ) =>
                                    i !==
                                    index
                                )
                            );
                          }}
                        >
                          Remove
                        </button>

                      </div>
                    )
                  )}

                </div>
              )}

            </div>

            {/* STATUS */}

            <div className="section">

              <label>
                System Status
              </label>

              <div className="status">
                {status}
              </div>

              {error && (
                <div className="error">
                  {error}
                </div>
              )}

            </div>

            <div className="help">

              <b>
                Map Tools
              </b>

              <div>
                • Mouse wheel: Zoom
              </div>

              <div>
                • Drag: Pan
              </div>

              <div>
                • Control Point: Click marker
              </div>

              <div>
                • Trig/BM: Click marker
              </div>

              <div>
                • Measurement: Ruler tool
              </div>

              <div>
                • Layers: Layer control
              </div>

              <div>
                • KML / SHP: Upload survey data
              </div>

            </div>
          </>
        ) : (

          /* =================================================
             OVERVIEW
          ================================================= */

          <>
            <div className="intro">

              <h2>
                Survey Archive
              </h2>

              <p>
                Select a survey project
                to view its detailed
                spatial data.
              </p>

            </div>

            <div className="section">

              <label>
                Search Projects
              </label>

              <input
                className="input"
                value={
                  search
                }
                onChange={(
                  event
                ) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder="Search project..."
              />

            </div>

            <div className="summary">

              <b>
                {
                  PROJECTS.length
                } Projects
              </b>

              <span>
                All available survey
                projects are listed below.
              </span>

            </div>

            <div className="section">

              <label>
                Projects
              </label>

              {filteredProjects.length ? (
                <div className="list">

                  {[
                    ...filteredProjects,
                  ]
                    .sort(
                      (
                        a,
                        b
                      ) =>
                        a.code.localeCompare(
                          b.code
                        )
                    )
                    .map(
                      (
                        project
                      ) => (
                        <button
                          key={
                            project.id
                          }
                          className="item"
                          onClick={() =>
                            openProject(
                              project
                            )
                          }
                        >

                          <strong>
                            {
                              project.code
                            }
                          </strong>

                          <span>

                            <b>
                              {
                                project.name
                              }
                            </b>

                            <small>
                              {
                                project.location
                              }
                              {" • "}
                              {
                                project.year
                              }
                            </small>

                          </span>

                        </button>
                      )
                    )}

                </div>
              ) : (
                <div className="empty">
                  No project found.
                </div>
              )}

            </div>

            {/* INITIAL UPLOAD */}

            <div className="upload">

              <b>
                Upload Survey Data
              </b>

              <input
                id="overview-file-upload"
                type="file"
                accept=".kml,.zip"
                multiple
                style={{
                  display:
                    "none",
                }}
                onChange={
                  handleUpload
                }
              />

              <label
                htmlFor="overview-file-upload"
                className="upload-btn"
                style={{
                  display:
                    "block",

                  textAlign:
                    "center",

                  cursor:
                    "pointer",
                }}
              >
                + Upload KML / SHP
              </label>

              <small>
                Upload KML directly or
                upload a ZIP containing
                the SHP components.
              </small>

              {uploads.length > 0 && (
                <div className="uploads">

                  {uploads.map(
                    (
                      upload,
                      index
                    ) => (
                      <div
                        className="upload-card"
                        key={`${upload.name}-${index}`}
                      >

                        <b>
                          {
                            upload.name
                          }
                        </b>

                        <small>
                          {
                            upload.type
                          } loaded
                        </small>

                        <button
                          onClick={() => {
                            upload.layer.remove();

                            setUploads(
                              (
                                previous
                              ) =>
                                previous.filter(
                                  (
                                    _,
                                    i
                                  ) =>
                                    i !==
                                    index
                                )
                            );
                          }}
                        >
                          Remove
                        </button>

                      </div>
                    )
                  )}

                </div>
              )}

            </div>

            {/* COMMON DATA */}

            <div className="summary">

              <b>
                Common Data
              </b>

              <span>
                Trig / BM:{" "}
                {
                  trigPoints.length
                }
              </span>

              <small>
                Common Trig/BM data is
                available across projects.
              </small>

            </div>

            {/* HELP */}

            <div className="help">

              <b>
                How to use
              </b>

              <div>
                • Select a project
              </div>

              <div>
                • Map zooms to survey data
              </div>

              <div>
                • Click a control point
              </div>

              <div>
                • Click a Trig/BM point
              </div>

              <div>
                • Control point photos load automatically
              </div>

              <div>
                • Use the layer control
              </div>

              <div>
                • Use measurement for distance and area
              </div>

            </div>

            <div className="section">

              <div className="status">
                {status}
              </div>

              {error && (
                <div className="error">
                  {error}
                </div>
              )}

            </div>

          </>
        )}

      </aside>

      {/* =================================================
          MAP
      ================================================= */}

      <main className="map">

        <div id="map" />

        <div className="map-title">

          <b>
            {selectedProject
              ? selectedProject.code
              : "SURVEY WEBGIS"}
          </b>

          <span>
            {selectedProject
              ? selectedProject.name
              : "Survey Archive & Project Overview"}
          </span>

        </div>

        <div className="legend">

          <div>
            <span className="dot cp" />
            Control Point
          </div>

          <div>
            <span className="dot trig" />
            Trig
          </div>

          <div>
            <span className="dot bm" />
            BM
          </div>

          <div>
            <span className="line cross" />
            Cross Section
          </div>

          <div>
            <span className="line boundary" />
            Survey Boundary
          </div>

        </div>

      </main>

    </div>
  );
}

/* =========================================================
   START REACT
========================================================= */

createRoot(
  document.getElementById(
    "root"
  )
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
