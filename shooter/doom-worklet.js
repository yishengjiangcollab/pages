registerPaint('doom', class {
	static get inputProperties() {
		return ['--positionX', '--positionY', '--headTurnDegree'];
	}

	paint(ctx, size, props) {
		const w = size.width;
		const h = size.height;
		if (w <= 0 || h <= 0) return;

		// Parse properties
		const posX = props.get('--positionX').value;
		const posY = props.get('--positionY').value;
		const headTurnDeg = props.get('--headTurnDegree').value; // in degrees

		const dirRad = headTurnDeg * Math.PI / 180;
		const dirX = Math.cos(dirRad);
		const dirY = Math.sin(dirRad);
		const planeX = dirY * 0.66; // Perpendicular vector for camera plane (FOV factor ~66°)
		const planeY = -dirX * 0.66;

		// Hardcoded 24x24 map (0 = empty, >0 = wall type)
		const mapWidth = 24;
		const mapHeight = 24;
		const worldMap = [
			[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 0, 0, 0, 0, 3, 0, 3, 0, 3, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 2, 2, 0, 2, 2, 0, 0, 0, 0, 3, 0, 3, 0, 3, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
			[1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1],
			[1, 4, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1],
			[1, 4, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1],
			[1, 4, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 1],
			[1, 4, 0, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1],
			[1, 4, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1],
			[1, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1],
			[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
		];

		for (let x = 0;x < w;x++) {
			const cameraX = 2 * x / w - 1;
			const rayDirX = dirX + planeX * cameraX;
			const rayDirY = dirY + planeY * cameraX;

			let mapX = Math.floor(posX);
			let mapY = Math.floor(posY);

			const deltaDistX = (rayDirX === 0) ? 1e30 : Math.abs(1 / rayDirX);
			const deltaDistY = (rayDirY === 0) ? 1e30 : Math.abs(1 / rayDirY);

			let stepX, stepY;
			let sideDistX, sideDistY;

			if (rayDirX < 0) {
				stepX = -1;
				sideDistX = (posX - mapX) * deltaDistX;
			} else {
				stepX = 1;
				sideDistX = (mapX + 1 - posX) * deltaDistX;
			}
			if (rayDirY < 0) {
				stepY = -1;
				sideDistY = (posY - mapY) * deltaDistY;
			} else {
				stepY = 1;
				sideDistY = (mapY + 1 - posY) * deltaDistY;
			}

			let hit = false;
			let side;
			while (!hit) {
				if (sideDistX < sideDistY) {
					sideDistX += deltaDistX;
					mapX += stepX;
					side = 0;
				} else {
					sideDistY += deltaDistY;
					mapY += stepY;
					side = 1;
				}
				if (worldMap[mapX][mapY] > 0) hit = true;
			}

			let perpWallDist;
			if (side === 0) perpWallDist = sideDistX - deltaDistX;
			else perpWallDist = sideDistY - deltaDistY;

			const lineHeight = Math.floor(h / perpWallDist);

			let drawStart = Math.floor(-lineHeight / 2 + h / 2);
			if (drawStart < 0) drawStart = 0;
			let drawEnd = Math.floor(lineHeight / 2 + h / 2);
			if (drawEnd > h) drawEnd = h;

			// Wall color based on type
			let color;
			const wallType = worldMap[mapX][mapY];
			switch (wallType) {
				case 1: color = 'rgb(255,0,0)'; break; // red
				case 2: color = 'rgb(0,255,0)'; break; // green
				case 3: color = 'rgb(0,0,255)'; break; // blue
				case 4: color = 'rgb(255,255,255)'; break; // white
				case 5: color = 'rgb(255,255,0)'; break; // yellow
				default: color = 'rgb(128,128,128)'; // gray
			}
			if (side === 1) {
				// Darken for y-sides
				const [r, g, b] = color.match(/\d+/g).map(Number);
				color = `rgb(${Math.floor(r / 2)}, ${Math.floor(g / 2)}, ${Math.floor(b / 2)})`;
			}

			// Draw ceiling (flat dark gray)
			ctx.fillStyle = 'darkgray';
			ctx.fillRect(x, 0, 1, drawStart);

			// Draw wall
			ctx.fillStyle = color;
			ctx.fillRect(x, drawStart, 1, drawEnd - drawStart);

			// Draw floor (flat gray)
			ctx.fillStyle = 'gray';
			ctx.fillRect(x, drawEnd, 1, h - drawEnd);
		}
	}
});