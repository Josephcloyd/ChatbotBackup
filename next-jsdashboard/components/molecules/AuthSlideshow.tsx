"use client";

import { useEffect, useState } from "react";
import { PixelBlast } from "./PixelBlast";

import { useTheme } from "../providers/ThemeProvider";

const SLIDESHOW_IMAGES = [
  "/login_images/Gemini_Generated_Image_7h0und7h0und7h0u.png",
  "/login_images/Gemini_Generated_Image_afqsssafqsssafqs.png",
  "/login_images/Gemini_Generated_Image_aqpz3aaqpz3aaqpz.png",
  "/login_images/Gemini_Generated_Image_z1emn4z1emn4z1em.png",
];

export function AuthSlideshow() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { theme } = useTheme();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % SLIDESHOW_IMAGES.length);
    }, 6000);

    return () => clearInterval(timer);
  }, []);

  const pixelColor = theme === "dark" ? "#34d399" : "#12815b";

  return (
    <div className="auth-slideshow-container" aria-hidden="true">
      {SLIDESHOW_IMAGES.map((src, index) => {
        const isActive = index === currentIndex;
        return (
          <div
            key={src}
            className={`auth-slide ${isActive ? "active" : ""}`}
            style={{ backgroundImage: `url('${src}')` }}
          />
        );
      })}

      {/* Interactive WebGL PixelBlast Effect Layer */}
      <div className="auth-pixel-blast-layer">
        <PixelBlast
          variant="circle"
          pixelSize={6}
          color={pixelColor}
          patternScale={3}
          patternDensity={1.2}
          pixelSizeJitter={0.5}
          enableRipples={true}
          rippleSpeed={0.4}
          rippleThickness={0.12}
          rippleIntensityScale={1.5}
          liquid={true}
          liquidStrength={0.12}
          liquidRadius={1.2}
          liquidWobbleSpeed={5}
          speed={0.6}
          edgeFade={0.25}
          transparent={true}
        />
      </div>

      <div className="auth-slideshow-overlay" />
    </div>
  );
}
