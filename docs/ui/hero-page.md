You are given a task to integrate an existing React component in the codebase

The codebase should support:

- shadcn project structure  

- Tailwind CSS

- Typescript

If it doesn't, provide instructions on how to setup project via shadcn CLI, install Tailwind or Typescript.

Determine the default path for components and styles. 

If default path for components is not /components/ui, provide instructions on why it's important to create this folder

Copy-paste this component to /components/ui folder:

```tsx

constellation-grid.tsx

    'use client';

    import React, { useEffect, useRef, useState } from 'react';

    interface Node {

        x: number;

        y: number;

        vx: number;

        vy: number;

        baseX: number;

        baseY: number;

        radius: number;

        label: string;

        pulse: number;

    }

    export default function ConstellationGrid() {

        const canvasRef = useRef&lt;HTMLCanvasElement | null&gt;(null);

        const [isDarkMode, setIsDarkMode] = useState&lt;boolean&gt;(true);

        // Sync theme preference

        useEffect(() =&gt; {

            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

            setIsDarkMode(mediaQuery.matches);

            const handler = (e: MediaQueryListEvent) =&gt; setIsDarkMode(e.matches);

            mediaQuery.addEventListener('change', handler);

            return () =&gt; mediaQuery.removeEventListener('change', handler);

        }, []);

        useEffect(() =&gt; {

            const canvas = canvasRef.current;

            if (!canvas) return;

            const ctx = canvas.getContext('2d', { alpha: false });

            if (!ctx) return;

            let animationFrameId: number;

            let width = 0;

            let height = 0;

            // Mouse velocity &amp; inertial tracking

            const mouse = {

                x: -1000,

                y: -1000,

                prevX: -1000,

                prevY: -1000,

                vx: 0,

                vy: 0,

                radius: 220,

            };

            let nodes: Node[] = [];

            const handleResize = () =&gt; {

                const dpr = Math.min(window.devicePixelRatio || 1, 2);

                width = window.innerWidth;

                height = window.innerHeight;

                canvas.width = width * dpr;

                canvas.height = height * dpr;

                [canvas.style](http://canvas.style).width = `${width}px`;

                [canvas.style](http://canvas.style).height = `${height}px`;

                ctx.scale(dpr, dpr);

                initNodes();

            };

            const handleMouseMove = (e: MouseEvent) =&gt; {

                mouse.x = e.clientX;

                mouse.y = e.clientY;

            };

            const handleMouseLeave = () =&gt; {

                mouse.x = -1000;

                mouse.y = -1000;

            };

            const initNodes = () =&gt; {

                nodes = [];

                const spacing = 55; // Tighter grid density for richer visual connections

                const cols = Math.ceil(width / spacing) + 1;

                const rows = Math.ceil(height / spacing) + 1;

                for (let i = 0; i &lt; cols; i++) {

                    for (let j = 0; j &lt; rows; j++) {

                        const x = i * spacing;

                        const y = j * spacing;

                        nodes.push({

                            x,

                            y,

                            vx: 0,

                            vy: 0,

                            baseX: x,

                            baseY: y,

                            radius: Math.random() * 1.2 + 1.2,

                            label: `${(i * 7).toString(16).toUpperCase()}:${(j * 11).toString(16).toUpperCase()}`,

                            pulse: Math.random() * Math.PI * 2,

                        });

                    }

                }

            };

            handleResize();

            window.addEventListener('resize', handleResize);

            window.addEventListener('mousemove', handleMouseMove);

            window.addEventListener('mouseleave', handleMouseLeave);

            let lastTime = [performance.now](http://performance.now)();

            const render = (now: number) =&gt; {

                // Normalize dt across high-refresh displays

                const dt = Math.min((now - lastTime) / 1000, 0.05);

                lastTime = now;

                // Mouse velocity calculation

                mouse.vx = (mouse.x - mouse.prevX) / (dt * 1000 || 1);

                mouse.vy = (mouse.y - mouse.prevY) / (dt * 1000 || 1);

                mouse.prevX = mouse.x;

                mouse.prevY = mouse.y;

                const speed = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);

                // Color paletting for dark/light seamlessness

                const bgColor = isDarkMode ? '#030407' : '#f8fafc';

                const nodeColor = isDarkMode ? '255, 255, 255' : '15, 23, 42';

                const accentColor = isDarkMode ? '56, 189, 248' : '2, 132, 199'; // Sky Cyan Accent

                ctx.fillStyle = bgColor;

                ctx.fillRect(0, 0, width, height);

                // Node Physics Engine (Hooke's Law Spring-Mass-Damping system)

                const SPRING_K = 18; // Spring stiffness

                const DAMPING = 0.82; // Velocity resistance

                for (let i = 0; i &lt; nodes.length; i++) {

                    const n = nodes[i];

                    n.pulse += dt * 3;

                    // Mouse distance vectors

                    const dx = mouse.x - n.x;

                    const dy = mouse.y - n.y;

                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // Dynamic shockwave repulsion based on cursor speed

                    if (dist &lt; mouse.radius &amp;&amp; dist &gt; 0) {

                        const power = (1 - dist / mouse.radius);

                        const force = power * (1500 + speed * 150);

                        const angle = Math.atan2(dy, dx);

                        // Impulse force pushing node away from cursor

                        n.vx -= Math.cos(angle) * force * dt;

                        n.vy -= Math.sin(angle) * force * dt;

                    }

                    // Calculate restoring force back to home anchor point (baseX, baseY)

                    const homeDx = n.baseX - n.x;

                    const homeDy = n.baseY - n.y;

                    n.vx += homeDx * SPRING_K * dt;

                    n.vy += homeDy * SPRING_K * dt;

                    // Apply Damping

                    n.vx *= DAMPING;

                    n.vy *= DAMPING;

                    // Integrate position

                    n.x += n.vx * dt * 60;

                    n.y += n.vy * dt * 60;

                }

                // Draw Connections (Optimized Distance Culling)

                const MAX_CONN_DIST = 75;

                const MAX_CONN_DIST_SQ = MAX_CONN_DIST * MAX_CONN_DIST;

                for (let i = 0; i &lt; nodes.length; i++) {

                    const n = nodes[i];

                    for (let j = i + 1; j &lt; nodes.length; j++) {

                        const n2 = nodes[j];

                        const ndx = n.x - n2.x;

                        const ndy = n.y - n2.y;

                        const distSq = ndx * ndx + ndy * ndy;

                        if (distSq &lt; MAX_CONN_DIST_SQ) {

                            const nDist = Math.sqrt(distSq);

                            const alpha = (1 - nDist / MAX_CONN_DIST) * (isDarkMode ? 0.18 : 0.08);

                            ctx.strokeStyle = `rgba(${nodeColor}, ${alpha})`;

                            ctx.lineWidth = 0.7;

                            ctx.beginPath();

                            ctx.moveTo(n.x, n.y);

                            ctx.lineTo(n2.x, n2.y);

                            ctx.stroke();

                        }

                    }

                }

                // Render Node Points &amp; Interactive Highlights

                for (let i = 0; i &lt; nodes.length; i++) {

                    const n = nodes[i];

                    const dx = mouse.x - n.x;

                    const dy = mouse.y - n.y;

                    const dist = Math.sqrt(dx * dx + dy * dy);

                    const isNear = dist &lt; mouse.radius;

                    // Node base opacity pulse

                    const baseAlpha = isNear ? 0.95 : 0.25 + Math.sin(n.pulse) * 0.1;

                    ctx.fillStyle = isNear

                        ? `rgba(${accentColor}, ${baseAlpha})`

                        : `rgba(${nodeColor}, ${baseAlpha})`;

                    const currentRadius = isNear

                        ? n.radius * 2.2

                        : n.radius + Math.sin(n.pulse) * 0.3;

                    ctx.beginPath();

                    ctx.arc(n.x, n.y, Math.max(0.5, currentRadius), 0, Math.PI * 2);

                    ctx.fill();

                    // High-tech Spatial Radar Rings on active proximity

                    if (dist &lt; 90) {

                        const pulseRing = ((n.pulse * 20) % 30) + 4;

                        const ringAlpha = (1 - pulseRing / 34) * 0.4;

                        ctx.strokeStyle = `rgba(${accentColor}, ${ringAlpha})`;

                        ctx.lineWidth = 1;

                        ctx.beginPath();

                        ctx.arc(n.x, n.y, pulseRing, 0, Math.PI * 2);

                        ctx.stroke();

                        // Hex Coordinate Readout

                        ctx.font = '8px ui-monospace, SFMono-Regular, Consolas, monospace';

                        ctx.fillStyle = `rgba(${accentColor}, 0.85)`;

                        ctx.fillText(n.label, n.x + 10, n.y - 10);

                    }

                }

                animationFrameId = requestAnimationFrame(render);

            };

            animationFrameId = requestAnimationFrame(render);

            return () =&gt; {

                cancelAnimationFrame(animationFrameId);

                window.removeEventListener('resize', handleResize);

                window.removeEventListener('mousemove', handleMouseMove);

                window.removeEventListener('mouseleave', handleMouseLeave);

            };

        }, [isDarkMode]);

        return (

            &lt;div className="relative w-full h-screen overflow-hidden select-none bg-slate-950 dark:bg-slate-950 light:bg-slate-50"&gt;

                &lt;canvas ref={canvasRef} className="absolute inset-0 block cursor-crosshair" /&gt;

                {/* Seamless overlay title */}

                &lt;div className="relative z-10 flex h-full flex-col items-center justify-center text-center px-4 pointer-events-none mix-blend-difference text-white"&gt;

                    &lt;h1 className="font-mono text-6xl md:text-9xl font-black tracking-tighter uppercase leading-none"&gt;

                        Constellation

                    &lt;/h1&gt;

                    &lt;p className="mt-4 font-mono text-xs md:text-sm max-w-lg opacity-70"&gt;

                        High-velocity dynamic mesh. Sweep your cursor quickly across the grid to unleash kinetic shockwaves.

                    &lt;/p&gt;

                &lt;/div&gt;

            &lt;/div&gt;

        );

    }

demo.tsx

// This is a file with a demo for your component

// That's what users will see in the preview

// Create new files in this directory to add more demos

import ConstellationGrid from "@/components/ui/constellation-grid";

// ONLY DEFAULT EXPORT WILL BE TREATED AS A DEMO

export default function DemoOne() {

  return &lt;ConstellationGrid /&gt;;

}

```

Implementation Guidelines

 1. Analyze the component structure and identify all required dependencies

 2. Review the component's argumens and state

 3. Identify any required context providers or hooks and install them

 4. Questions to Ask

 - What data/props will be passed to this component?

 - Are there any specific state management requirements?

 - Are there any required assets (images, icons, etc.)?

 - What is the expected responsive behavior?

 - What is the best place to use this component in the app?

Steps to integrate

 0. Copy paste all the code above in the correct directories

 1. Install external dependencies

 2. Fill image assets with Unsplash stock images you know exist

 3. Use lucide-react icons for svgs or logos if component requires them

