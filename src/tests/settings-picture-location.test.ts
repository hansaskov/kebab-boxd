import { describe, expect, it } from "vitest";
import { isInputError } from "astro:actions";
import { server } from "@src/actions/index";
import SettingsPage from "@src/pages/[username]/settings.astro";
import { actionContext, form } from "@src/tests/actions";
import { renderPage } from "@src/tests/container";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";
import { emptyFileInput, nameOf, pictureFile, storedPictureNames, textFile } from "@src/tests/pictures";

function userRow(client: ReturnType<typeof createTestDatabase>["client"], id: number) {
	return client.query.users.findFirst({ with: { profilePicture: true }, where: { id } }).sync();
}

describe("updateProfilePicture and removeProfilePicture actions", () => {
	it("replace the profile picture, remove the old file, and remove the picture again", async () => {
		const { client, db, picturesDirectory } = createTestDatabase("settings-profile-picture");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const context = actionContext(db, session);

		await server.updateProfilePicture.call(context, form({ currentUsername: "ada", picture: await pictureFile() }));
		const first = userRow(client, ada.id)?.profilePicture;
		const replaced = await server.updateProfilePicture.call(context, form({ currentUsername: "ada", picture: await pictureFile() }));
		const second = userRow(client, ada.id)?.profilePicture;

		expect(replaced.data).toEqual({ redirect: "/ada/settings" });
		expect(second?.url).not.toBe(first?.url);
		expect(storedPictureNames(picturesDirectory)).toEqual([nameOf(second!.url)]);
		expect((await renderPage(SettingsPage, { db, session }, "/ada/settings", { username: "ada" })).html).toContain(`src="${second!.url}"`);

		await server.removeProfilePicture.call(context, form({ currentUsername: "ada" }));

		expect(userRow(client, ada.id)?.profilePicture).toBeNull();
		expect(storedPictureNames(picturesDirectory)).toEqual([]);
		expect(client.query.pictures.findMany().sync()).toEqual([]);
	});

	it("refuse an empty field, a file that is not a picture, and the account of someone else", async () => {
		const { client, db, picturesDirectory } = createTestDatabase("settings-profile-picture-refused");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		const context = actionContext(db, await signIn(db, ada.id));

		const empty = await server.updateProfilePicture.call(context, form({ currentUsername: "ada", picture: emptyFileInput() }));
		const text = await server.updateProfilePicture.call(context, form({ currentUsername: "ada", picture: textFile() }));
		const other = await server.updateProfilePicture.call(context, form({ currentUsername: "bob", picture: await pictureFile() }));

		expect(empty.error && isInputError(empty.error) && empty.error.fields.picture).toEqual(["Choose a picture."]);
		expect(text.error?.code).toBe("BAD_REQUEST");
		expect(other.error?.code).toBe("FORBIDDEN");
		expect(storedPictureNames(picturesDirectory)).toEqual([]);
	});
});

describe("updateLocation action", () => {
	it("saves the coordinates of the user, shows them in the settings, and clears them", async () => {
		const { client, db } = createTestDatabase("settings-location");
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const context = actionContext(db, session);

		await server.updateLocation.call(context, form({ currentUsername: "ada", location: " 55.3959,10.3883 " }));

		expect(userRow(client, ada.id)).toMatchObject({ latitude: 55.3959, longitude: 10.3883 });
		expect((await renderPage(SettingsPage, { db, session }, "/ada/settings", { username: "ada" })).html).toContain(
			'value="55.3959, 10.3883"',
		);

		await server.updateLocation.call(context, form({ currentUsername: "ada", location: "" }));

		expect(userRow(client, ada.id)).toMatchObject({ latitude: null, longitude: null });
	});

	it("refuses coordinates that are not on earth", async () => {
		const { client, db } = createTestDatabase("settings-location-invalid");
		const ada = insertUser(client, "ada");

		const result = await server.updateLocation.call(
			actionContext(db, await signIn(db, ada.id)),
			form({ currentUsername: "ada", location: "55.4, 190" }),
		);

		expect(result.error && isInputError(result.error) && result.error.fields.location).toBeTruthy();
		expect(userRow(client, ada.id)).toMatchObject({ latitude: null, longitude: null });
	});
});
